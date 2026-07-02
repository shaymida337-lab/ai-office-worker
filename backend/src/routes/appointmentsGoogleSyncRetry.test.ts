import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";

import { apiRouter } from "./api.js";
import { prisma } from "../lib/prisma.js";
import { signToken, type JwtPayload } from "../lib/auth.js";

const ORG_A = "org-a";
const ORG_B = "org-b";
const OWNER_A: JwtPayload = { organizationId: ORG_A, userId: "owner-a", email: "owner-a@example.com" };
const READ_ONLY_A: JwtPayload = { organizationId: ORG_A, userId: "read-a", email: "read-a@example.com" };

type AppointmentRow = {
  id: string;
  organizationId: string;
  status: string;
  googleEventId: string | null;
  googleSyncStatus: string;
  googleSyncAttemptCount: number;
  lastGoogleSyncError: string | null;
  lastGoogleSyncAt: Date | null;
  nextGoogleSyncRetryAt: Date | null;
  startTime: Date;
  durationMinutes: number;
  notes: string | null;
  client: { id: string; name: string };
  service: { id: string; name: string } | null;
};

function createAppWithMocks() {
  const rows = new Map<string, AppointmentRow>();
  rows.set("appt-success", {
    id: "appt-success",
    organizationId: ORG_A,
    status: "cancelled",
    googleEventId: null,
    googleSyncStatus: "failed",
    googleSyncAttemptCount: 0,
    lastGoogleSyncError: "x",
    lastGoogleSyncAt: null,
    nextGoogleSyncRetryAt: null,
    startTime: new Date("2026-07-02T10:00:00.000Z"),
    durationMinutes: 30,
    notes: null,
    client: { id: "c1", name: "Client 1" },
    service: null,
  });
  rows.set("appt-fail", {
    id: "appt-fail",
    organizationId: ORG_A,
    status: "pending",
    googleEventId: null,
    googleSyncStatus: "failed",
    googleSyncAttemptCount: 0,
    lastGoogleSyncError: null,
    lastGoogleSyncAt: null,
    nextGoogleSyncRetryAt: null,
    startTime: new Date("2026-07-02T11:00:00.000Z"),
    durationMinutes: 30,
    notes: null,
    client: { id: "c2", name: "Client 2" },
    service: null,
  });

  const originals = {
    member: prisma.organizationMember.findUnique.bind(prisma.organizationMember),
    orgFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    apptFindFirst: prisma.appointment.findFirst.bind(prisma.appointment),
    apptFindUnique: prisma.appointment.findUnique.bind(prisma.appointment),
    apptUpdate: prisma.appointment.update.bind(prisma.appointment),
    integrationFindUnique: prisma.integration.findUnique.bind(prisma.integration),
    auditCreate: prisma.platformAuditLog.create.bind(prisma.platformAuditLog),
  };

  prisma.organizationMember.findUnique = (async (args) => {
    const orgId = args?.where?.organizationId_userId?.organizationId;
    const userId = args?.where?.organizationId_userId?.userId;
    if (orgId === ORG_A && userId === OWNER_A.userId) return { id: "m1", role: "owner" };
    if (orgId === ORG_A && userId === READ_ONLY_A.userId) return { id: "m2", role: "read_only" };
    if (orgId === ORG_B && userId === "owner-b") return { id: "m3", role: "owner" };
    return null;
  }) as typeof prisma.organizationMember.findUnique;

  prisma.organization.findUnique = (async (args) => {
    const orgId = args?.where?.id as string | undefined;
    if (!orgId) return null;
    return { id: orgId, userId: orgId === ORG_A ? OWNER_A.userId : "owner-b" };
  }) as typeof prisma.organization.findUnique;

  prisma.appointment.findFirst = (async (args) => {
    const id = args?.where?.id as string | undefined;
    const orgId = args?.where?.organizationId as string | undefined;
    if (!id || !orgId) return null;
    const row = rows.get(id);
    if (!row || row.organizationId !== orgId) return null;
    return { id: row.id };
  }) as typeof prisma.appointment.findFirst;

  prisma.appointment.findUnique = (async (args) => {
    const id = args?.where?.id as string | undefined;
    if (!id) return null;
    const row = rows.get(id);
    return row ?? null;
  }) as typeof prisma.appointment.findUnique;

  prisma.appointment.update = (async (args) => {
    const id = args.where.id;
    const row = rows.get(id);
    if (!row) throw new Error("not found");
    Object.assign(row, args.data);
    return row;
  }) as typeof prisma.appointment.update;

  prisma.integration.findUnique = (async () => null) as typeof prisma.integration.findUnique;
  prisma.platformAuditLog.create = (async (args) => ({
    id: "audit-1",
    createdAt: new Date(),
    organizationId: args.data.organizationId,
    correlationId: args.data.correlationId ?? null,
    actorType: args.data.actorType,
    actorId: args.data.actorId ?? null,
    entityType: args.data.entityType,
    entityId: args.data.entityId,
    action: args.data.action,
    severity: args.data.severity ?? "info",
    sourceModule: args.data.sourceModule,
    sourceRoute: args.data.sourceRoute ?? null,
    beforeState: args.data.beforeState ?? null,
    afterState: args.data.afterState ?? null,
    reason: args.data.reason ?? null,
    metadata: args.data.metadata ?? null,
  })) as typeof prisma.platformAuditLog.create;

  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);

  return {
    app,
    rows,
    restore: () => {
      prisma.organizationMember.findUnique = originals.member;
      prisma.organization.findUnique = originals.orgFindUnique;
      prisma.appointment.findFirst = originals.apptFindFirst;
      prisma.appointment.findUnique = originals.apptFindUnique;
      prisma.appointment.update = originals.apptUpdate;
      prisma.integration.findUnique = originals.integrationFindUnique;
      prisma.platformAuditLog.create = originals.auditCreate;
    },
  };
}

async function call(path: string, token?: string) {
  const { app, restore } = createAppWithMocks();
  const server = app.listen(0);
  try {
    const addr = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json();
    return { status: res.status, body: json };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restore();
  }
}

test("manual retry endpoint requires auth", async () => {
  const res = await call("/api/appointments/appt-success/google-sync/retry");
  assert.equal(res.status, 401);
});

test("manual retry endpoint requires calendar permission", async () => {
  const token = signToken(READ_ONLY_A);
  const res = await call("/api/appointments/appt-success/google-sync/retry", token);
  assert.equal(res.status, 403);
});

test("manual retry endpoint is organization scoped", async () => {
  const token = signToken({ organizationId: ORG_B, userId: "owner-b", email: "owner-b@example.com" });
  const res = await call("/api/appointments/appt-success/google-sync/retry", token);
  assert.equal(res.status, 404);
});

test("manual retry endpoint returns synced result on successful retry path", async () => {
  const token = signToken(OWNER_A);
  const res = await call("/api/appointments/appt-success/google-sync/retry", token);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.appointment.googleSyncStatus, "synced");
});

test("manual retry endpoint keeps failure visible", async () => {
  const token = signToken(OWNER_A);
  const res = await call("/api/appointments/appt-fail/google-sync/retry", token);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.appointment.googleSyncStatus, "disabled");
  assert.equal(typeof res.body.appointment.lastGoogleSyncError, "string");
});

