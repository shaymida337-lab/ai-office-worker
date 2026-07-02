import test from "node:test";
import assert from "node:assert/strict";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  idempotencyErrorResponse,
} from "./idempotency.js";

type Row = {
  id: string;
  organizationId: string;
  routeKey: string;
  idempotencyKey: string;
  requestHash: string;
  statusCode: number | null;
  responseBodyJson: unknown;
  completedAt: Date | null;
};

function mockPrisma() {
  const rows = new Map<string, Row>();
  const key = (organizationId: string, routeKey: string, idempotencyKey: string) =>
    `${organizationId}:${routeKey}:${idempotencyKey}`;

  const prisma = {
    apiIdempotencyKey: {
      findUnique: async (args: {
        where: { organizationId_routeKey_idempotencyKey: { organizationId: string; routeKey: string; idempotencyKey: string } };
      }) => {
        const w = args.where.organizationId_routeKey_idempotencyKey;
        return rows.get(key(w.organizationId, w.routeKey, w.idempotencyKey)) ?? null;
      },
      create: async (args: {
        data: {
          organizationId: string;
          routeKey: string;
          idempotencyKey: string;
          requestHash: string;
        };
        select: { id: true };
      }) => {
        const k = key(args.data.organizationId, args.data.routeKey, args.data.idempotencyKey);
        if (rows.has(k)) {
          const err = new Error("duplicate");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
        const id = `idem-${rows.size + 1}`;
        rows.set(k, {
          id,
          organizationId: args.data.organizationId,
          routeKey: args.data.routeKey,
          idempotencyKey: args.data.idempotencyKey,
          requestHash: args.data.requestHash,
          statusCode: null,
          responseBodyJson: null,
          completedAt: null,
        });
        return { id };
      },
      update: async (args: {
        where: { id: string };
        data: { statusCode: number; responseBodyJson: unknown; completedAt: Date };
      }) => {
        const row = [...rows.values()].find((item) => item.id === args.where.id);
        if (!row) throw new Error("row not found");
        row.statusCode = args.data.statusCode;
        row.responseBodyJson = args.data.responseBodyJson;
        row.completedAt = args.data.completedAt;
        return row;
      },
    },
  };

  return { prisma, rows };
}

test("idempotency replays successful response for same key and payload", async () => {
  const { prisma } = mockPrisma();
  const first = await beginIdempotentRequest({
    prisma: prisma as never,
    organizationId: "org-1",
    routeKey: "POST:/appointments",
    method: "POST",
    idempotencyKeyHeader: "abc",
    body: { startTime: "2026-07-03T10:00:00.000Z" },
  });
  assert.equal(first.mode, "active");
  if (first.mode === "active") {
    await completeIdempotentRequest({
      prisma: prisma as never,
      recordId: first.recordId,
      statusCode: 201,
      responseBody: { id: "appt-1", ok: true },
    });
  }

  const second = await beginIdempotentRequest({
    prisma: prisma as never,
    organizationId: "org-1",
    routeKey: "POST:/appointments",
    method: "POST",
    idempotencyKeyHeader: "abc",
    body: { startTime: "2026-07-03T10:00:00.000Z" },
  });

  assert.equal(second.mode, "replay");
  if (second.mode === "replay") {
    assert.equal(second.statusCode, 201);
    assert.deepEqual(second.responseBody, { id: "appt-1", ok: true });
  }
});

test("idempotency key mismatch returns conflict response", () => {
  const conflict = idempotencyErrorResponse(new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"));
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.body.code, "idempotency_mismatch");
});
