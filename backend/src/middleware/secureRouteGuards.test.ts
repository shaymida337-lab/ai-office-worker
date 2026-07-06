import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { secureRouteGuards } from "./secureRouteGuards.js";

const ORG_ID = "org-rbac-test";
const OWNER_ID = "user-owner";
const READ_ONLY_ID = "user-read-only";

function mockMembership() {
  const originalMember = prisma.organizationMember.findUnique.bind(prisma.organizationMember);
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalAudit = prisma.platformAuditLog.create.bind(prisma.platformAuditLog);

  prisma.organizationMember.findUnique = (async (args) => {
    const orgId = args?.where?.organizationId_userId?.organizationId;
    const userId = args?.where?.organizationId_userId?.userId;
    if (orgId === ORG_ID && userId === OWNER_ID) return { id: "member-owner", role: "owner" };
    if (orgId === ORG_ID && userId === READ_ONLY_ID) return { id: "member-read-only", role: "read_only" };
    return null;
  }) as typeof prisma.organizationMember.findUnique;

  prisma.organization.findUnique = (async (args) => {
    const id = args?.where?.id;
    if (id === ORG_ID) return { id: ORG_ID, userId: OWNER_ID };
    return null;
  }) as typeof prisma.organization.findUnique;

  prisma.platformAuditLog.create = (async () => ({ id: "audit-1" })) as typeof prisma.platformAuditLog.create;

  return () => {
    prisma.organizationMember.findUnique = originalMember;
    prisma.organization.findUnique = originalOrg;
    prisma.platformAuditLog.create = originalAudit;
  };
}

function runGuard(input: { userId: string; method?: string; path: string }) {
  return new Promise<{ statusCode: number; body: unknown; reachedHandler: boolean }>((resolve) => {
    const req = {
      method: input.method ?? "POST",
      path: input.path,
      baseUrl: "/api",
      route: { path: input.path },
      auth: { userId: input.userId, organizationId: ORG_ID, email: `${input.userId}@example.com` },
    } as Request;

    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        resolve({ statusCode: this.statusCode, body: payload, reachedHandler: false });
        return this;
      },
    } as Response;

    const next: NextFunction = () => {
      resolve({ statusCode: 200, body: null, reachedHandler: true });
    };

    secureRouteGuards(req, res, next);
  });
}

test("read_only receives 403 for POST /whatsapp-assistant/test/morning", async () => {
  const restore = mockMembership();
  try {
    const result = await runGuard({
      userId: READ_ONLY_ID,
      path: "/whatsapp-assistant/test/morning",
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.reachedHandler, false);
    assert.match(String((result.body as { reason?: string })?.reason ?? ""), /organization\.settings/);
  } finally {
    restore();
  }
});

test("owner passes RBAC guard for POST /whatsapp-assistant/test/morning", async () => {
  const restore = mockMembership();
  try {
    const result = await runGuard({
      userId: OWNER_ID,
      path: "/whatsapp-assistant/test/morning",
    });
    assert.equal(result.reachedHandler, true);
  } finally {
    restore();
  }
});

test("read_only receives 403 for legacy GET /whatsapp/test", async () => {
  const restore = mockMembership();
  try {
    const result = await runGuard({
      userId: READ_ONLY_ID,
      method: "GET",
      path: "/whatsapp/test",
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.reachedHandler, false);
  } finally {
    restore();
  }
});
