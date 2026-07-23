import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  resolveVerifiedTenant,
  resetVerifiedTenantCacheForTests,
  invalidateVerifiedTenant,
} from "./verifiedTenant.js";
import {
  VERIFIED_TENANT_NEGATIVE_TTL_MS,
  VERIFIED_TENANT_POSITIVE_TTL_MS,
  peekVerifiedTenantCache,
  setVerifiedTenantPositiveCache,
  getVerifiedTenantCacheGeneration,
  verifiedTenantCacheSizeForTests,
} from "./verifiedTenantCache.js";
import { checkPermission } from "../rbac/authorization.js";
import { computeUnaccountedMs } from "../../lib/appointmentsEndpointTiming.js";

const USER = "user-cache-1";
const ORG = "org-cache-1";
const OTHER_USER = "user-cache-2";
const OTHER_ORG = "org-cache-2";

function auth(overrides: Partial<{ userId: string; organizationId: string; email: string }> = {}) {
  return {
    userId: overrides.userId ?? USER,
    organizationId: overrides.organizationId ?? ORG,
    email: overrides.email ?? "u@example.com",
  };
}

beforeEach(() => {
  resetVerifiedTenantCacheForTests();
});

test("fresh hit → 0 DB", async () => {
  let dbCalls = 0;
  const miss = await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => {
      dbCalls += 1;
      return {
        tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "owner" },
      };
    },
  });
  assert.equal(miss.cacheSource, "miss");
  assert.equal(dbCalls, 1);

  const hit = await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => {
      dbCalls += 1;
      throw new Error("DB should not run on hit");
    },
  });
  assert.equal(hit.cacheSource, "hit");
  assert.equal(hit.dbMs, 0);
  assert.ok((hit.cacheAgeMs ?? 0) < 5 || hit.cacheAgeMs === 0 || (hit.cacheAgeMs ?? 0) < 100);
  assert.equal(hit.tenant?.role, "owner");
  assert.equal(dbCalls, 1);
});

test("miss → DB once", async () => {
  let dbCalls = 0;
  await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => {
      dbCalls += 1;
      return {
        tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "admin" },
      };
    },
  });
  assert.equal(dbCalls, 1);
});

test("two parallel requests → one in-flight DB load", async () => {
  let dbCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  const loadFromDb = async () => {
    dbCalls += 1;
    await gate;
    return {
      tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "owner" as const },
    };
  };

  const p1 = resolveVerifiedTenant(auth(), { loadFromDb });
  const p2 = resolveVerifiedTenant(auth(), { loadFromDb });
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(dbCalls, 1);
  assert.ok(a.cacheSource === "miss" || a.cacheSource === "inflight");
  assert.ok(b.cacheSource === "miss" || b.cacheSource === "inflight");
  assert.equal(a.tenant?.role, "owner");
  assert.equal(b.tenant?.role, "owner");
});

test("expired → DB again", async () => {
  let dbCalls = 0;
  const loadFromDb = async () => {
    dbCalls += 1;
    return {
      tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "owner" as const },
    };
  };
  await resolveVerifiedTenant(auth(), { loadFromDb });
  const gen = getVerifiedTenantCacheGeneration(USER, ORG);
  setVerifiedTenantPositiveCache({
    userId: USER,
    organizationId: ORG,
    role: "owner",
    generationAtStart: gen,
    ttlMs: -1,
  });
  assert.equal(peekVerifiedTenantCache(USER, ORG), null);

  await resolveVerifiedTenant(auth(), { loadFromDb });
  assert.equal(dbCalls, 2);
});

test("user isolation: other user does not reuse cache", async () => {
  let dbCalls = 0;
  await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => {
      dbCalls += 1;
      return {
        tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "owner" },
      };
    },
  });
  await resolveVerifiedTenant(auth({ userId: OTHER_USER }), {
    loadFromDb: async () => {
      dbCalls += 1;
      return {
        tenant: {
          userId: OTHER_USER,
          organizationId: ORG,
          email: "o@example.com",
          role: "employee",
        },
      };
    },
  });
  assert.equal(dbCalls, 2);
});

test("organization isolation: other org does not reuse cache", async () => {
  let dbCalls = 0;
  await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => {
      dbCalls += 1;
      return {
        tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "owner" },
      };
    },
  });
  await resolveVerifiedTenant(auth({ organizationId: OTHER_ORG }), {
    loadFromDb: async () => {
      dbCalls += 1;
      return {
        tenant: {
          userId: USER,
          organizationId: OTHER_ORG,
          email: "u@example.com",
          role: "owner",
        },
      };
    },
  });
  assert.equal(dbCalls, 2);
});

test("role change invalidation forces DB reload", async () => {
  let role: "owner" | "admin" = "owner";
  const loadFromDb = async () => ({
    tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role },
  });
  await resolveVerifiedTenant(auth(), { loadFromDb });
  role = "admin";
  invalidateVerifiedTenant(USER, ORG);
  const after = await resolveVerifiedTenant(auth(), { loadFromDb });
  assert.equal(after.cacheSource, "miss");
  assert.equal(after.tenant?.role, "admin");
});

test("membership removal invalidation → denied and no positive cache", async () => {
  await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => ({
      tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "employee" },
    }),
  });
  invalidateVerifiedTenant(USER, ORG);
  const denied = await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => ({ tenant: null, reason: "membership_denied" }),
  });
  assert.equal(denied.tenant, null);
  assert.equal(denied.reason, "membership_denied");
  const peek = peekVerifiedTenantCache(USER, ORG);
  assert.equal(peek?.status, "denied");
  assert.ok((peek!.expiresAt - peek!.loadedAt) <= VERIFIED_TENANT_NEGATIVE_TTL_MS);
});

test("forbidden role preserved through cache + checkPermission reuse", async () => {
  const resolved = await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => ({
      tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "read_only" },
    }),
  });
  const perm = await checkPermission({
    userId: USER,
    organizationId: ORG,
    permission: "calendar.create",
    verifiedTenant: {
      userId: resolved.tenant!.userId,
      organizationId: resolved.tenant!.organizationId,
      role: resolved.tenant!.role,
      verified: true,
    },
  });
  assert.equal(perm.allowed, false);
  assert.equal(perm.role, "read_only");
});

test("DB failure does not create fake positive cache", async () => {
  await assert.rejects(
    () =>
      resolveVerifiedTenant(auth(), {
        loadFromDb: async () => {
          throw new Error("db down");
        },
      }),
    /db down/
  );
  assert.equal(verifiedTenantCacheSizeForTests(), 0);
});

test("verifiedTenant request reuse still works after cache hit", async () => {
  const first = await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => ({
      tenant: { userId: USER, organizationId: ORG, email: "u@example.com", role: "owner" },
    }),
  });
  const second = await resolveVerifiedTenant(auth(), {
    loadFromDb: async () => {
      throw new Error("no db");
    },
  });
  assert.equal(second.cacheSource, "hit");
  let membershipCalls = 0;
  const perm = await checkPermission(
    {
      userId: USER,
      organizationId: ORG,
      permission: "calendar.view",
      verifiedTenant: {
        userId: second.tenant!.userId,
        organizationId: second.tenant!.organizationId,
        role: second.tenant!.role,
        verified: true,
      },
    },
    {
      resolveMembershipRole: async () => {
        membershipCalls += 1;
        return null;
      },
    }
  );
  assert.equal(perm.allowed, true);
  assert.equal(membershipCalls, 0);
  assert.equal(first.tenant?.role, "owner");
});

test("appointments org phase stays 0 with cache hit shape", () => {
  const unaccounted = computeUnaccountedMs({
    preRouteMs: 0,
    authMs: 1,
    authToOrgMs: 1,
    tenantMs: 2,
    tenantDbMs: 0,
    orgMs: 0,
    orgToDbMs: 0,
    dbMs: 759,
    dbToMapMs: 0,
    mapMs: 0,
    jsonMs: 0,
    responseMs: 0,
    middlewareMs: 1,
    eventLoopMs: 0,
    totalMs: 763,
    rowCount: 1,
    prismaCallCount: 1,
    authDbRoundTrips: 0,
    tenantDbRoundTrips: 0,
    orgDbRoundTrips: 0,
    eventsDbRoundTrips: 1,
  });
  assert.ok(unaccounted < 50);
  assert.ok(VERIFIED_TENANT_POSITIVE_TTL_MS === 30_000);
});
