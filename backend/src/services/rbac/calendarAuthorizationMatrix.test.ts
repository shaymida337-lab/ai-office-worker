import test from "node:test";
import assert from "node:assert/strict";
import { requirePermissionMiddleware } from "./rbacMiddleware.js";

function createRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

test("calendar middleware returns 401 when auth is missing", async () => {
  const middleware = requirePermissionMiddleware("calendar.view");
  const req = {} as Parameters<typeof middleware>[0];
  const res = createRes();
  let nextCalled = false;
  await middleware(req, res as never, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("calendar middleware returns 403 for read_only create", async () => {
  const middleware = requirePermissionMiddleware("calendar.create", {
    checkPermission: async () => ({
      allowed: false,
      permission: "calendar.create",
      role: "read_only",
      organizationId: "org-1",
      reason: "Role read_only does not have permission calendar.create",
    }),
  });
  const req = {
    method: "POST",
    baseUrl: "/api",
    path: "/appointments",
    route: { path: "/appointments" },
    auth: { organizationId: "org-1", userId: "user-1", email: "x@example.com" },
  } as unknown as Parameters<typeof middleware>[0];
  const res = createRes();
  let nextCalled = false;
  await middleware(req, res as never, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("calendar middleware allows owner decision approval", async () => {
  const middleware = requirePermissionMiddleware("calendar.approve_decision", {
    checkPermission: async () => ({
      allowed: true,
      permission: "calendar.approve_decision",
      role: "owner",
      organizationId: "org-1",
      reason: "owner is allowed calendar.approve_decision",
    }),
  });
  const req = {
    method: "POST",
    baseUrl: "/api",
    path: "/owner-decisions/1/approve",
    route: { path: "/owner-decisions/:id/approve" },
    auth: { organizationId: "org-1", userId: "owner-1", email: "o@example.com" },
  } as unknown as Parameters<typeof middleware>[0];
  const res = createRes();
  let nextCalled = false;
  await middleware(req, res as never, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
});
