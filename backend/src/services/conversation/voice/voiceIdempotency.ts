import { performance } from "node:perf_hooks";
import type { PrismaClient } from "@prisma/client";
import { beginIdempotentRequest, completeIdempotentRequest } from "../../idempotency.js";

export const VOICE_TURN_ROUTE_KEY = "natalie/voice/turn";

export type VoiceTurnIdempotencyBody = {
  transcript: string;
  sessionId: string | null;
  turnId: string;
};

export type VoiceTurnIdempotencyBeginResult =
  | { mode: "disabled" }
  | { mode: "replay"; responseBody: unknown; lookupLatencyMs: number }
  | { mode: "active"; recordId: string; lookupLatencyMs: number };

export async function beginVoiceTurnIdempotency(input: {
  prisma: PrismaClient;
  organizationId: string;
  turnId?: string | null;
  body: VoiceTurnIdempotencyBody;
}): Promise<VoiceTurnIdempotencyBeginResult> {
  const startedAt = performance.now();
  const result = await beginIdempotentRequest({
    prisma: input.prisma,
    organizationId: input.organizationId,
    idempotencyKeyHeader: input.turnId ?? undefined,
    routeKey: VOICE_TURN_ROUTE_KEY,
    method: "POST",
    body: input.body,
  });
  const lookupLatencyMs = performance.now() - startedAt;

  if (result.mode === "replay") {
    return {
      mode: "replay",
      responseBody: result.responseBody,
      lookupLatencyMs,
    };
  }
  if (result.mode === "active") {
    return {
      mode: "active",
      recordId: result.recordId,
      lookupLatencyMs,
    };
  }
  return { mode: "disabled" };
}

export async function completeVoiceTurnIdempotency(input: {
  prisma: PrismaClient;
  recordId: string;
  responseBody: unknown;
}) {
  await completeIdempotentRequest({
    prisma: input.prisma,
    recordId: input.recordId,
    statusCode: 200,
    responseBody: input.responseBody,
  });
}

export async function measureIdempotencyLookupLatency(input: {
  prisma: PrismaClient;
  organizationId: string;
  turnId: string;
}): Promise<number> {
  const startedAt = performance.now();
  await input.prisma.apiIdempotencyKey.findUnique({
    where: {
      organizationId_routeKey_idempotencyKey: {
        organizationId: input.organizationId,
        routeKey: VOICE_TURN_ROUTE_KEY,
        idempotencyKey: input.turnId,
      },
    },
    select: { id: true },
  });
  return performance.now() - startedAt;
}
