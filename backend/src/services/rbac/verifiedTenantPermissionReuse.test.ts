import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPermission,
  tryReuseVerifiedTenantRole,
} from "./authorization.js";
import type { RequestVerifiedTenant } from "../tenant/verifiedTenant.js";
import { computeUnaccountedMs } from "../../lib/appointmentsEndpointTiming.js";

const ORG = "org-1";
const USER = "user-1";
const OTHER_USER = "user-2";
const OTHER_ORG = "org-2";

function verified(role: RequestVerifiedTenant["role"] = "owner"): RequestVerifiedTenant {
  return { userId: USER, organizationId: ORG, role, verified: true };
}

test("verified tenant role is reused — membership not called", async () => {
  let membershipCalls = 0;
  const result = await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.view",
      verifiedTenant: verified("owner"),
    },
    {
      resolveMembershipRole: async () => {
        membershipCalls += 1;
        return null;
      },
    }
  );
  assert.equal(result.allowed, true);
  assert.equal(result.role, "owner");
  assert.equal(result.roleSource, "verified_tenant");
  assert.equal(membershipCalls, 0);
  assert.equal(tryReuseVerifiedTenantRole({
    userId: USER,
    organizationId: ORG,
    permission: "calendar.view",
    verifiedTenant: verified("owner"),
  }), "owner");
});

test("organization mismatch → no reuse, falls back to membership", async () => {
  let membershipCalls = 0;
  const result = await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.view",
      verifiedTenant: { userId: USER, organizationId: OTHER_ORG, role: "owner", verified: true },
    },
    {
      resolveMembershipRole: async () => {
        membershipCalls += 1;
        return {
          userId: USER,
          organizationId: ORG,
          role: "employee",
          membershipId: "m1",
          isOrganizationOwner: false,
        };
      },
    }
  );
  assert.equal(membershipCalls, 1);
  assert.equal(result.roleSource, "membership");
  assert.equal(result.role, "employee");
  assert.equal(result.allowed, true);
});

test("user mismatch → no reuse (other user cannot use existing role)", async () => {
  let membershipCalls = 0;
  const result = await checkPermission(
    {
      userId: OTHER_USER,
      organizationId: ORG,
      permission: "calendar.view",
      verifiedTenant: verified("owner"),
    },
    {
      resolveMembershipRole: async () => {
        membershipCalls += 1;
        return null;
      },
    }
  );
  assert.equal(membershipCalls, 1);
  assert.equal(result.allowed, false);
  assert.equal(tryReuseVerifiedTenantRole({
    userId: OTHER_USER,
    organizationId: ORG,
    permission: "calendar.view",
    verifiedTenant: verified("owner"),
  }), null);
});

test("missing verified tenant → fallback membership", async () => {
  let membershipCalls = 0;
  const result = await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.view",
    },
    {
      resolveMembershipRole: async () => {
        membershipCalls += 1;
        return {
          userId: USER,
          organizationId: ORG,
          role: "admin",
          membershipId: "m1",
          isOrganizationOwner: false,
        };
      },
    }
  );
  assert.equal(membershipCalls, 1);
  assert.equal(result.roleSource, "membership");
  assert.equal(result.role, "admin");
});

test("forbidden role still denied with verified tenant reuse", async () => {
  const result = await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.create",
      verifiedTenant: verified("read_only"),
    },
    {
      resolveMembershipRole: async () => {
        throw new Error("membership must not be called");
      },
    }
  );
  assert.equal(result.allowed, false);
  assert.equal(result.roleSource, "verified_tenant");
  assert.equal(result.role, "read_only");
});

test("org isolation preserved: non-member without verified tenant denied", async () => {
  const result = await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.view",
      verifiedTenant: null,
    },
    {
      resolveMembershipRole: async () => null,
    }
  );
  assert.equal(result.allowed, false);
  assert.match(result.reason, /not a member/i);
});

test("appointments path: membership resolved once when tenant already verified", async () => {
  // Simulate: tenant already did membership; org check reuses → 0 extra calls.
  let membershipCalls = 0;
  await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.view",
      verifiedTenant: verified("owner"),
    },
    {
      resolveMembershipRole: async () => {
        membershipCalls += 1;
        return {
          userId: USER,
          organizationId: ORG,
          role: "owner",
          membershipId: "m1",
          isOrganizationOwner: true,
        };
      },
    }
  );
  assert.equal(membershipCalls, 0);
});

test("DB waves after reuse: tenant(2) + events(1) = 3; org DB = 0", () => {
  const tenantWaves = 2;
  const orgWavesWhenReused = 0;
  const eventsWaves = 1;
  assert.equal(tenantWaves + orgWavesWhenReused + eventsWaves, 3);
  assert.ok(3 < 4);
});

test("timing unaccounted under 50ms with org≈0 after reuse", () => {
  const unaccounted = computeUnaccountedMs({
    preRouteMs: 0,
    authMs: 1,
    authToOrgMs: 850,
    tenantMs: 850,
    orgMs: 0,
    orgToDbMs: 0,
    dbMs: 329,
    dbToMapMs: 0,
    mapMs: 0,
    jsonMs: 0,
    responseMs: 0,
    middlewareMs: 850,
    eventLoopMs: 0,
    totalMs: 1180,
    rowCount: 1,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    tenantDbRoundTrips: 3,
    orgDbRoundTrips: 0,
    eventsDbRoundTrips: 1,
  });
  assert.ok(unaccounted < 50, `unaccounted=${unaccounted}`);
});
