import express from "express";
import test from "node:test";
import assert from "node:assert/strict";

import type { JwtPayload } from "../lib/auth.js";
import { createAuditLogRouter } from "./auditLogRoutes.js";
import { allowAllPermissionsMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { PlatformAuditReadDb } from "../services/auditLog/auditQueries.js";
import type { PlatformAuditRecord } from "../services/auditLog/auditTypes.js";
import { mapRowToRecord } from "../services/auditLog/auditWriter.js";

const ORG_A = "org-audit-route-a";
const ORG_B = "org-audit-route-b";
const AUTH_A: JwtPayload = { organizationId: ORG_A, userId: "user-a", email: "a@example.com" };

function seedRecords(): PlatformAuditRecord[] {
  const base = new Date("2026-07-01T12:00:00.000Z");
  return [
    {
      auditId: "audit-1",
      timestamp: base.toISOString(),
      organizationId: ORG_A,
      correlationId: "gmail:abc",
      actorType: "user",
      actorId: "user-a",
      entityType: "supplier_payment",
      entityId: "pay-1",
      action: "payment_created",
      severity: "important",
      sourceModule: "api",
      sourceRoute: "PATCH /payments/:id",
      beforeState: null,
      afterState: { id: "pay-1" },
      reason: null,
      metadata: null,
    },
    {
      auditId: "audit-2",
      timestamp: new Date(base.getTime() + 1000).toISOString(),
      organizationId: ORG_A,
      correlationId: "gmail:abc",
      actorType: "user",
      actorId: "user-a",
      entityType: "financial_document_review",
      entityId: "rev-1",
      action: "document_approved",
      severity: "important",
      sourceModule: "financialDocuments",
      sourceRoute: null,
      beforeState: { reviewStatus: "needs_review" },
      afterState: { reviewStatus: "approved" },
      reason: null,
      metadata: null,
    },
    {
      auditId: "audit-b",
      timestamp: base.toISOString(),
      organizationId: ORG_B,
      correlationId: null,
      actorType: "system",
      actorId: null,
      entityType: "integration",
      entityId: "int-b",
      action: "integration_connected",
      severity: "info",
      sourceModule: "integrations",
      sourceRoute: null,
      beforeState: null,
      afterState: null,
      reason: null,
      metadata: { gmail: true, drive: true },
    },
  ];
}

function createTestRouter(records = seedRecords()) {
  const router = express.Router();
  router.get("/audit", async (req, res) => {
    let items = records.filter((row) => row.organizationId === req.auth!.organizationId);
    if (typeof req.query.action === "string") items = items.filter((row) => row.action === req.query.action);
    if (typeof req.query.correlationId === "string") {
      items = items.filter((row) => row.correlationId === req.query.correlationId);
    }
    res.json({ organizationId: req.auth!.organizationId, items, nextCursor: null, totalInPage: items.length });
  });
  router.get("/audit/:entityId", async (req, res) => {
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : null;
    if (!entityType) {
      res.status(400).json({ error: "entityType query parameter is required" });
      return;
    }
    const items = records.filter(
      (row) =>
        row.organizationId === req.auth!.organizationId &&
        row.entityType === entityType &&
        row.entityId === req.params.entityId,
    );
    res.json({
      organizationId: req.auth!.organizationId,
      entityType,
      entityId: req.params.entityId,
      items,
      nextCursor: null,
      totalInPage: items.length,
    });
  });
  return router;
}

function createAuthedApp(router: express.Router, auth: JwtPayload) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = auth;
    next();
  });
  app.use(router);
  return app;
}

async function withServer(app: express.Express, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function api(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { "Content-Type": "application/json" } });
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  return { status: res.status, body };
}

test("GET /audit returns organization-scoped audit list", async () => {
  const app = createAuthedApp(createTestRouter(), AUTH_A);
  await withServer(app, async (baseUrl) => {
    const res = await api(baseUrl, "/audit");
    assert.equal(res.status, 200);
    assert.equal(res.body.organizationId, ORG_A);
    assert.equal(res.body.items.length, 2);
    assert.ok(res.body.items.every((item: PlatformAuditRecord) => item.organizationId === ORG_A));
  });
});

test("GET /audit supports action and correlationId filters", async () => {
  const app = createAuthedApp(createTestRouter(), AUTH_A);
  await withServer(app, async (baseUrl) => {
    const byAction = await api(baseUrl, "/audit?action=payment_created");
    assert.equal(byAction.body.items.length, 1);
    assert.equal(byAction.body.items[0].action, "payment_created");

    const byCorrelation = await api(baseUrl, "/audit?correlationId=gmail:abc");
    assert.equal(byCorrelation.body.items.length, 2);
  });
});

test("GET /audit/:entityId requires entityType and scopes to entity timeline", async () => {
  const app = createAuthedApp(createTestRouter(), AUTH_A);
  await withServer(app, async (baseUrl) => {
    const missing = await api(baseUrl, "/audit/pay-1");
    assert.equal(missing.status, 400);

    const entity = await api(baseUrl, "/audit/pay-1?entityType=supplier_payment");
    assert.equal(entity.status, 200);
    assert.equal(entity.body.entityId, "pay-1");
    assert.equal(entity.body.items.length, 1);
    assert.equal(entity.body.items[0].entityType, "supplier_payment");
  });
});

test("audit route layer is read-only", () => {
  const router = createAuditLogRouter({
    db: { platformAuditLog: { findMany: async () => [] } } as PlatformAuditReadDb,
    requirePermission: () => allowAllPermissionsMiddleware(),
  });
  const stack = (router as unknown as { stack: Array<{ route?: { methods?: Record<string, boolean>; path?: string } }> }).stack;
  const routes = stack
    .map((layer) => layer.route)
    .filter(Boolean)
    .map((route) => ({ methods: Object.keys(route!.methods ?? {}), path: route!.path }));
  assert.deepEqual(routes, [
    { methods: ["get"], path: "/audit" },
    { methods: ["get"], path: "/audit/:entityId" },
  ]);
});

test("mapRowToRecord exposes auditId and ISO timestamp", () => {
  const row = {
    id: "audit-row-1",
    organizationId: ORG_A,
    correlationId: "gmail:abc",
    actorType: "user",
    actorId: "user-a",
    entityType: "supplier_payment",
    entityId: "pay-1",
    action: "payment_created",
    severity: "important",
    sourceModule: "api",
    sourceRoute: null,
    beforeState: null,
    afterState: null,
    reason: null,
    metadata: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
  };
  const record = mapRowToRecord(row as never);
  assert.equal(record.auditId, "audit-row-1");
  assert.equal(record.timestamp, "2026-07-01T12:00:00.000Z");
});
