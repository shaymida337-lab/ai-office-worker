import { createHash } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type IdempotencyRecord = {
  id: string;
  organizationId: string;
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number | null;
  responseBodyJson: unknown;
};

export type IdempotencyBeginResult =
  | { mode: "disabled" }
  | { mode: "replay"; statusCode: number; responseBody: unknown }
  | { mode: "active"; recordId: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map((item) => stableStringify(item)).join(",")}]`;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashRequest(input: { method: string; routeKey: string; body: unknown }): string {
  const payload = `${input.method.toUpperCase()}|${input.routeKey}|${stableStringify(input.body ?? null)}`;
  return createHash("sha256").update(payload).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

function normalizeIdempotencyKey(value: string | undefined): string | null {
  if (!value) return null;
  const key = value.trim();
  if (!key) return null;
  if (key.length > 200) return key.slice(0, 200);
  return key;
}

async function awaitCompletedRecord(
  prisma: PrismaClient,
  where: { organizationId: string; routeKey: string; idempotencyKey: string },
  requestHash: string
): Promise<IdempotencyBeginResult> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const existing = await prisma.apiIdempotencyKey.findUnique({
      where: {
        organizationId_routeKey_idempotencyKey: {
          organizationId: where.organizationId,
          routeKey: where.routeKey,
          idempotencyKey: where.idempotencyKey,
        },
      },
    });
    if (!existing) return { mode: "active", recordId: "" };
    if (existing.requestHash !== requestHash) {
      throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
    }
    if (existing.statusCode !== null && existing.responseBodyJson !== null) {
      return {
        mode: "replay",
        statusCode: existing.statusCode,
        responseBody: existing.responseBodyJson,
      };
    }
    await sleep(100);
  }
  throw new Error("IDEMPOTENCY_REQUEST_IN_PROGRESS");
}

export async function beginIdempotentRequest(params: {
  prisma: PrismaClient;
  organizationId: string;
  idempotencyKeyHeader?: string;
  routeKey: string;
  method: string;
  body: unknown;
}): Promise<IdempotencyBeginResult> {
  const key = normalizeIdempotencyKey(params.idempotencyKeyHeader);
  if (!key) return { mode: "disabled" };

  const requestHash = hashRequest({
    method: params.method,
    routeKey: params.routeKey,
    body: params.body,
  });

  const uniqueWhere = {
    organizationId_routeKey_idempotencyKey: {
      organizationId: params.organizationId,
      routeKey: params.routeKey,
      idempotencyKey: key,
    },
  };

  const existing = await params.prisma.apiIdempotencyKey.findUnique({ where: uniqueWhere });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
    }
    if (existing.statusCode !== null && existing.responseBodyJson !== null) {
      return {
        mode: "replay",
        statusCode: existing.statusCode,
        responseBody: existing.responseBodyJson,
      };
    }
    return await awaitCompletedRecord(
      params.prisma,
      { organizationId: params.organizationId, routeKey: params.routeKey, idempotencyKey: key },
      requestHash
    );
  }

  try {
    const created = await params.prisma.apiIdempotencyKey.create({
      data: {
        organizationId: params.organizationId,
        routeKey: params.routeKey,
        idempotencyKey: key,
        requestHash,
      },
      select: { id: true },
    });
    return { mode: "active", recordId: created.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const awaited = await awaitCompletedRecord(
      params.prisma,
      { organizationId: params.organizationId, routeKey: params.routeKey, idempotencyKey: key },
      requestHash
    );
    if (awaited.mode === "active" && !awaited.recordId) {
      const row = await params.prisma.apiIdempotencyKey.findUnique({ where: uniqueWhere, select: { id: true } });
      if (!row) throw new Error("IDEMPOTENCY_ROW_NOT_FOUND");
      return { mode: "active", recordId: row.id };
    }
    return awaited;
  }
}

export async function completeIdempotentRequest(params: {
  prisma: PrismaClient;
  recordId: string;
  statusCode: number;
  responseBody: unknown;
}) {
  await params.prisma.apiIdempotencyKey.update({
    where: { id: params.recordId },
    data: {
      statusCode: params.statusCode,
      responseBodyJson: (params.responseBody ?? null) as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

export function idempotencyErrorResponse(err: unknown): { statusCode: number; body: { error: string; code: string } } {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
    return {
      statusCode: 409,
      body: { error: "Idempotency key was already used with a different payload", code: "idempotency_mismatch" },
    };
  }
  if (message === "IDEMPOTENCY_REQUEST_IN_PROGRESS") {
    return {
      statusCode: 409,
      body: { error: "A request with this idempotency key is still processing", code: "idempotency_in_progress" },
    };
  }
  return {
    statusCode: 500,
    body: { error: "Idempotency processing failed", code: "idempotency_failed" },
  };
}
