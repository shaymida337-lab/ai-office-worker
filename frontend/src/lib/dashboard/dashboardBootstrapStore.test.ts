import assert from "node:assert/strict";
import test from "node:test";
import {
  __getDashboardBootstrapStoreSnapshotForTests,
  __resetDashboardBootstrapStoreForTests,
  __setDashboardBootstrapFetchForTests,
  __setDashboardBootstrapIdentityForTests,
  clearDashboardBootstrap,
  DASHBOARD_BOOTSTRAP_FRESH_MS,
  DASHBOARD_BOOTSTRAP_TTL_MS,
  getCachedDashboardBootstrap,
  getDashboardBootstrapDebugCounters,
  invalidateDashboardBootstrap,
  loadDashboardBootstrap,
  resolveDashboardBootstrapIdentityKey,
  setDashboardBootstrap,
  type DashboardBootstrapPayload,
} from "./dashboardBootstrapStore";

function payload(partial?: Partial<DashboardBootstrapPayload>): DashboardBootstrapPayload {
  return {
    organizationSettings: {
      id: "org-a",
      name: "שי",
      businessName: "שי",
      businessType: "insurance_agency",
      businessSize: "solo",
      mainBusinessPain: null,
      enabledModules: ["crm"],
      onboardingCompleted: true,
      onboardingRequired: false,
      recommendedModules: ["crm"],
      locale: "he-IL",
      language: "he",
      country: "IL",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      dateFormat: "dd/MM/yyyy",
      timeFormat: "24h",
      weekStart: "sunday",
      phoneCountryCode: "IL",
      displayName: "שי",
      ...(partial?.organizationSettings as object),
    } as DashboardBootstrapPayload["organizationSettings"],
    homeMetrics: {
      organizationId: "org-a",
      computedAt: "2026-07-15T10:00:00.000Z",
      timeZone: "Asia/Jerusalem",
      metrics: {
        active_clients: 41,
        open_tasks: 32,
        meetings_today: 0,
        pending_docs: 185,
        new_clients_this_month: 38,
        unread_alerts: 5457,
      },
      definitions: {
        active_clients: "a",
        open_tasks: "b",
        meetings_today: "c",
        pending_docs: "d",
        new_clients_this_month: "e",
        unread_alerts: "f",
      },
      ...partial?.homeMetrics,
    },
    gmailStatus: {
      connected: true,
      scanning: false,
      lastScanAt: null,
      googleConfigured: true,
      connectedAt: null,
      ...partial?.gmailStatus,
    },
    tasksPreview: partial?.tasksPreview ?? [],
    generatedAt: partial?.generatedAt ?? "2026-07-15T10:00:00.000Z",
  };
}

test.beforeEach(() => {
  __resetDashboardBootstrapStoreForTests();
  __setDashboardBootstrapIdentityForTests(() => "user-a:org-a");
});

test("identity key never stores raw token", () => {
  // header.payload.sig — payload={"userId":"u1","organizationId":"o1"}
  const token =
    "eyJhbGciOiJub25lIn0." +
    Buffer.from(JSON.stringify({ userId: "u1", organizationId: "o1" })).toString("base64url") +
    ".x";
  assert.equal(resolveDashboardBootstrapIdentityKey(token), "u1:o1");
  assert.doesNotMatch(resolveDashboardBootstrapIdentityKey(token), /eyJ/);
});

test("two parallel consumers share one in-flight network promise", async () => {
  let calls = 0;
  __setDashboardBootstrapFetchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return payload();
  });
  const [a, b] = await Promise.all([loadDashboardBootstrap(), loadDashboardBootstrap()]);
  assert.equal(calls, 1);
  assert.equal(a.cacheSource, "network");
  assert.equal(b.cacheSource, "network");
  assert.equal(getDashboardBootstrapDebugCounters().networkCount, 1);
});

test("fresh memory cache → 0 network", async () => {
  let calls = 0;
  __setDashboardBootstrapFetchForTests(async () => {
    calls += 1;
    return payload();
  });
  await loadDashboardBootstrap();
  const again = await loadDashboardBootstrap();
  assert.equal(calls, 1);
  assert.equal(again.cacheSource, "memory");
  assert.equal(getCachedDashboardBootstrap()?.homeMetrics.metrics.active_clients, 41);
});

test("session snapshot → immediate Hero without network when memory empty", async () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown; sessionStorage?: Storage }).window = globalThis;
  (globalThis as { sessionStorage?: Storage }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;

  let calls = 0;
  __setDashboardBootstrapFetchForTests(async () => {
    calls += 1;
    return payload();
  });
  await loadDashboardBootstrap();
  assert.equal(calls, 1);
  assert.ok(store.size >= 1);

  const { __dropMemoryCacheKeepSessionForTests } = await import("./dashboardBootstrapStore");
  __dropMemoryCacheKeepSessionForTests();
  assert.equal(getCachedDashboardBootstrap(), null);

  const fromSession = await loadDashboardBootstrap();
  assert.equal(fromSession.cacheSource, "session");
  assert.equal(fromSession.payload.homeMetrics.metrics.active_clients, 41);
  assert.equal(calls, 1);

  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});

test("expired → one network await", async () => {
  let calls = 0;
  __setDashboardBootstrapFetchForTests(async () => {
    calls += 1;
    return payload();
  });
  await loadDashboardBootstrap();
  const { __ageDashboardBootstrapCacheForTests } = await import("./dashboardBootstrapStore");
  __ageDashboardBootstrapCacheForTests(DASHBOARD_BOOTSTRAP_TTL_MS + 1);
  const result = await loadDashboardBootstrap();
  assert.equal(result.cacheSource, "network");
  assert.equal(calls, 2);
});

test("stale → immediate data + one background refresh", async () => {
  let calls = 0;
  __setDashboardBootstrapFetchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return payload();
  });
  await loadDashboardBootstrap();
  assert.equal(calls, 1);

  const { __ageDashboardBootstrapCacheForTests } = await import("./dashboardBootstrapStore");
  __ageDashboardBootstrapCacheForTests(DASHBOARD_BOOTSTRAP_FRESH_MS + 1);

  const result = await loadDashboardBootstrap();
  assert.equal(result.cacheSource, "memory");
  assert.equal(result.payload.homeMetrics.metrics.active_clients, 41);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 2);
});

test("refresh failure keeps prior data; miss failure throws", async () => {
  let calls = 0;
  __setDashboardBootstrapFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return payload();
    throw new Error("network down");
  });
  await loadDashboardBootstrap();
  const kept = await loadDashboardBootstrap({ force: true });
  assert.equal(kept.payload.homeMetrics.metrics.active_clients, 41);

  clearDashboardBootstrap();
  __setDashboardBootstrapFetchForTests(async () => {
    throw new Error("miss fail");
  });
  await assert.rejects(() => loadDashboardBootstrap({ force: true }), /miss fail/);
});

test("logout/clear and identity isolation", async () => {
  __setDashboardBootstrapFetchForTests(async () => payload());
  await loadDashboardBootstrap();
  assert.ok(getCachedDashboardBootstrap());
  clearDashboardBootstrap();
  assert.equal(getCachedDashboardBootstrap(), null);

  __setDashboardBootstrapIdentityForTests(() => "user-a:org-a");
  await loadDashboardBootstrap();
  __setDashboardBootstrapIdentityForTests(() => "user-b:org-b");
  assert.equal(getCachedDashboardBootstrap(), null);
});

test("invalidate clears memory cache", async () => {
  __setDashboardBootstrapFetchForTests(async () => payload());
  await loadDashboardBootstrap();
  invalidateDashboardBootstrap();
  assert.equal(getCachedDashboardBootstrap(), null);
});

test("TTL constants match contract", () => {
  assert.equal(DASHBOARD_BOOTSTRAP_FRESH_MS, 30_000);
  assert.equal(DASHBOARD_BOOTSTRAP_TTL_MS, 5 * 60_000);
});
