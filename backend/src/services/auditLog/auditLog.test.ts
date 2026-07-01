import test from "node:test";
import assert from "node:assert/strict";
import type { PlatformAuditLog } from "@prisma/client";

import {
  appendPlatformAuditLog,
  mapRowToRecord,
  userAuditContext,
} from "./auditWriter.js";
import { listPlatformAuditLogs, parseAuditListFilters } from "./auditQueries.js";
import { resetAuditReliabilityDedupeForTests } from "./auditReliability.js";
import { buildAuditTrustContribution } from "./auditTrust.js";
import type { PlatformAuditDb } from "./auditWriter.js";

const ORG_A = "org-audit-a";
const ORG_B = "org-audit-b";
const CORR = "gmail:msg-123";

type StoredRow = PlatformAuditLog;

function createMockAuditDb(seed: StoredRow[] = []): PlatformAuditDb {
  const rows = [...seed];
  return {
    platformAuditLog: {
      async create({ data }) {
        const row = {
          id: `audit-${rows.length + 1}`,
          organizationId: data.organizationId,
          correlationId: data.correlationId ?? null,
          actorType: data.actorType,
          actorId: data.actorId ?? null,
          entityType: data.entityType,
          entityId: data.entityId,
          action: data.action,
          severity: data.severity ?? "info",
          sourceModule: data.sourceModule,
          sourceRoute: data.sourceRoute ?? null,
          beforeState: data.beforeState ?? null,
          afterState: data.afterState ?? null,
          reason: data.reason ?? null,
          metadata: data.metadata ?? null,
          createdAt: data.createdAt ?? new Date(),
        } satisfies StoredRow;
        rows.push(row);
        return row;
      },
      async findMany(args) {
        let filtered = rows.filter((row) => {
          const where = args.where ?? {};
          if (where.organizationId && row.organizationId !== where.organizationId) return false;
          if (where.entityType && row.entityType !== where.entityType) return false;
          if (where.entityId && row.entityId !== where.entityId) return false;
          if (where.actorId && row.actorId !== where.actorId) return false;
          if (where.action && row.action !== where.action) return false;
          if (where.correlationId && row.correlationId !== where.correlationId) return false;
          if (where.severity && row.severity !== where.severity) return false;
          if (where.createdAt && typeof where.createdAt === "object") {
            const range = where.createdAt as { gte?: Date; lte?: Date };
            if (range.gte && row.createdAt < range.gte) return false;
            if (range.lte && row.createdAt > range.lte) return false;
          }
          return true;
        });
        filtered = filtered.sort((a, b) => {
          const byTime = b.createdAt.getTime() - a.createdAt.getTime();
          if (byTime !== 0) return byTime;
          return b.id.localeCompare(a.id);
        });
        if (args.cursor?.id) {
          const idx = filtered.findIndex((row) => row.id === args.cursor!.id);
          if (idx >= 0) filtered = filtered.slice(idx + 1);
        }
        const take = args.take ?? filtered.length;
        return filtered.slice(0, take);
      },
    },
  } as unknown as PlatformAuditDb;
}

test("appendPlatformAuditLog is insert-only and captures before/after", async () => {
  resetAuditReliabilityDedupeForTests();
  const db = createMockAuditDb();
  const row = await appendPlatformAuditLog(
    {
      ...userAuditContext("user-1", "test", "PATCH /payments/1", CORR),
      organizationId: ORG_A,
      entityType: "supplier_payment",
      entityId: "pay-1",
      action: "payment_updated",
      beforeState: { paid: false },
      afterState: { paid: true },
    },
    db,
  );

  const record = mapRowToRecord(row);
  assert.equal(record.auditId, row.id);
  assert.ok(record.timestamp);
  assert.equal(record.organizationId, ORG_A);
  assert.equal(record.correlationId, CORR);
  assert.equal(record.actorType, "user");
  assert.equal(record.entityType, "supplier_payment");
  assert.deepEqual(record.beforeState, { paid: false });
  assert.deepEqual(record.afterState, { paid: true });

  const dbAny = db as unknown as { platformAuditLog: Record<string, unknown> };
  assert.equal(typeof db.platformAuditLog.create, "function");
  assert.equal(dbAny.platformAuditLog.update, undefined);
  assert.equal(dbAny.platformAuditLog.delete, undefined);
});

test("audit ids are unique and timestamps are present", async () => {
  const db = createMockAuditDb();
  const first = await appendPlatformAuditLog(
    {
      ...userAuditContext("user-1", "test"),
      organizationId: ORG_A,
      entityType: "supplier_payment",
      entityId: "pay-1",
      action: "payment_created",
    },
    db,
  );
  const second = await appendPlatformAuditLog(
    {
      ...userAuditContext("user-1", "test"),
      organizationId: ORG_A,
      entityType: "supplier_payment",
      entityId: "pay-2",
      action: "payment_created",
    },
    db,
  );
  assert.notEqual(first.id, second.id);
  assert.ok(first.createdAt instanceof Date);
  assert.ok(second.createdAt instanceof Date);
});

test("listPlatformAuditLogs enforces organization isolation", async () => {
  const t1 = new Date("2026-07-01T10:00:00.000Z");
  const t2 = new Date("2026-07-01T11:00:00.000Z");
  const db = createMockAuditDb([
    {
      id: "a1",
      organizationId: ORG_A,
      correlationId: CORR,
      actorType: "user",
      actorId: "u1",
      entityType: "supplier_payment",
      entityId: "p1",
      action: "payment_created",
      severity: "important",
      sourceModule: "api",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: t2,
    },
    {
      id: "b1",
      organizationId: ORG_B,
      correlationId: null,
      actorType: "system",
      actorId: null,
      entityType: "invoice",
      entityId: "i1",
      action: "invoice_deleted",
      severity: "info",
      sourceModule: "api",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: t1,
    },
  ]);

  const orgA = await listPlatformAuditLogs({ organizationId: ORG_A }, db);
  assert.equal(orgA.items.length, 1);
  assert.equal(orgA.items[0]?.auditId, "a1");

  const orgB = await listPlatformAuditLogs({ organizationId: ORG_B }, db);
  assert.equal(orgB.items.length, 1);
  assert.equal(orgB.items[0]?.auditId, "b1");
});

test("listPlatformAuditLogs filters by action, actor, correlationId, severity, and date range", async () => {
  const db = createMockAuditDb([
    {
      id: "1",
      organizationId: ORG_A,
      correlationId: CORR,
      actorType: "user",
      actorId: "actor-1",
      entityType: "financial_document_review",
      entityId: "r1",
      action: "document_approved",
      severity: "important",
      sourceModule: "financialDocuments",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
    },
    {
      id: "2",
      organizationId: ORG_A,
      correlationId: CORR,
      actorType: "user",
      actorId: "actor-2",
      entityType: "supplier_payment",
      entityId: "p1",
      action: "payment_created",
      severity: "info",
      sourceModule: "api",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date("2026-07-01T13:00:00.000Z"),
    },
  ]);

  const byAction = await listPlatformAuditLogs({ organizationId: ORG_A, action: "document_approved" }, db);
  assert.equal(byAction.items.length, 1);
  assert.equal(byAction.items[0]?.action, "document_approved");

  const byActor = await listPlatformAuditLogs({ organizationId: ORG_A, actorId: "actor-2" }, db);
  assert.equal(byActor.items.length, 1);

  const byCorrelation = await listPlatformAuditLogs({ organizationId: ORG_A, correlationId: CORR }, db);
  assert.equal(byCorrelation.items.length, 2);

  const bySeverity = await listPlatformAuditLogs({ organizationId: ORG_A, severity: "important" }, db);
  assert.equal(bySeverity.items.length, 1);

  const byRange = await listPlatformAuditLogs(
    {
      organizationId: ORG_A,
      from: new Date("2026-07-01T12:30:00.000Z"),
      to: new Date("2026-07-01T14:00:00.000Z"),
    },
    db,
  );
  assert.equal(byRange.items.length, 1);
  assert.equal(byRange.items[0]?.auditId, "2");
});

test("listPlatformAuditLogs returns chronological desc order with pagination cursor", async () => {
  const db = createMockAuditDb([
    {
      id: "old",
      organizationId: ORG_A,
      correlationId: null,
      actorType: "system",
      actorId: null,
      entityType: "integration",
      entityId: "i1",
      action: "integration_connected",
      severity: "info",
      sourceModule: "integrations",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
    },
    {
      id: "mid",
      organizationId: ORG_A,
      correlationId: null,
      actorType: "system",
      actorId: null,
      entityType: "integration",
      entityId: "i1",
      action: "integration_disconnected",
      severity: "info",
      sourceModule: "integrations",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date("2026-07-01T11:00:00.000Z"),
    },
    {
      id: "new",
      organizationId: ORG_A,
      correlationId: null,
      actorType: "user",
      actorId: "u1",
      entityType: "user",
      entityId: "u1",
      action: "user_login",
      severity: "info",
      sourceModule: "auth",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
    },
  ]);

  const page1 = await listPlatformAuditLogs({ organizationId: ORG_A, limit: 2 }, db);
  assert.equal(page1.items.length, 2);
  assert.equal(page1.items[0]?.auditId, "new");
  assert.equal(page1.items[1]?.auditId, "mid");
  assert.equal(page1.nextCursor, "mid");

  const page2 = await listPlatformAuditLogs({ organizationId: ORG_A, limit: 2, cursor: page1.nextCursor! }, db);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0]?.auditId, "old");
  assert.equal(page2.nextCursor, null);
});

test("parseAuditListFilters clamps limit", () => {
  const filters = parseAuditListFilters(ORG_A, { limit: "9999", action: "payment_created" });
  assert.equal(filters.limit, 200);
  assert.equal(filters.action, "payment_created");
});

test("buildAuditTrustContribution recognizes financial and security audit actions", () => {
  const financial = buildAuditTrustContribution([
    mapRowToRecord({
      id: "x",
      organizationId: ORG_A,
      correlationId: CORR,
      actorType: "user",
      actorId: "u1",
      entityType: "supplier_payment",
      entityId: "p1",
      action: "payment_created",
      severity: "important",
      sourceModule: "api",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date(),
    }),
  ]);
  assert.equal(financial.financialAuditCount, 1);
  assert.equal(financial.hasImmutableTrail, true);

  const security = buildAuditTrustContribution([
    mapRowToRecord({
      id: "y",
      organizationId: ORG_A,
      correlationId: null,
      actorType: "user",
      actorId: "u1",
      entityType: "user",
      entityId: "u1",
      action: "user_login",
      severity: "info",
      sourceModule: "auth",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: null,
      createdAt: new Date(),
    }),
  ]);
  assert.equal(security.securityAuditCount, 1);
  assert.equal(security.auditEvidenceCount, 1);
});
