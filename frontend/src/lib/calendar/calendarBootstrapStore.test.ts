import assert from "node:assert/strict";
import test from "node:test";
import {
  __ageCalendarBootstrapCacheForTests,
  __resetCalendarBootstrapStoreForTests,
  __setCalendarBootstrapFetchForTests,
  __setCalendarBootstrapIdentityForTests,
  CALENDAR_BOOTSTRAP_FRESH_MS,
  clearCalendarBootstrap,
  getCachedCalendarBootstrap,
  invalidateCalendarBootstrap,
  loadCalendarBootstrap,
  resolveCalendarBootstrapIdentityKey,
} from "./calendarBootstrapStore";

function payload() {
  return {
    capabilities: {
      calendarEngineReadEnabled: false,
      calendarEngineWriteEnabled: false,
      ownerDecisionQueueEnabled: false,
      googleMirrorEnabled: false,
      source: "org_disabled" as const,
    },
    connectionStatus: { connected: true, calendarId: "primary" },
    settings: { timezone: "Asia/Jerusalem", workday: { weekStart: "sunday" }, locale: "he-IL" },
    employees: [{ id: "e1", name: "Dana", color: "#3B82F6", isActive: true }],
    services: [
      {
        id: "s1",
        name: "Meeting",
        durationMinutes: 30,
        price: 100,
        color: "#111",
        isActive: true,
        employeeIds: ["e1"],
      },
    ],
    clientsSummary: [{ id: "c1", name: "Client", phone: "050" }],
    generatedAt: "2026-07-15T10:00:00.000Z",
  };
}

test.beforeEach(() => {
  __resetCalendarBootstrapStoreForTests();
  __setCalendarBootstrapIdentityForTests(() => "user-a:org-a");
});

test("identity key never stores raw token", () => {
  const token =
    "header." +
    Buffer.from(JSON.stringify({ userId: "u1", organizationId: "o1" })).toString("base64url") +
    ".sig";
  const key = resolveCalendarBootstrapIdentityKey(token);
  assert.equal(key, "u1:o1");
  assert.equal(key.includes(token), false);
});

test("two parallel consumers share one in-flight promise", async () => {
  let calls = 0;
  __setCalendarBootstrapFetchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return payload();
  });
  const [a, b] = await Promise.all([loadCalendarBootstrap(), loadCalendarBootstrap()]);
  assert.equal(calls, 1);
  assert.equal(a.cacheSource, "network");
  assert.equal(b.cacheSource, "network");
});

test("fresh memory cache → 0 network", async () => {
  let calls = 0;
  __setCalendarBootstrapFetchForTests(async () => {
    calls += 1;
    return payload();
  });
  await loadCalendarBootstrap();
  const again = await loadCalendarBootstrap();
  assert.equal(calls, 1);
  assert.equal(again.cacheSource, "memory");
});

test("stale → immediate + background refresh", async () => {
  let calls = 0;
  __setCalendarBootstrapFetchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return payload();
  });
  await loadCalendarBootstrap();
  __ageCalendarBootstrapCacheForTests(CALENDAR_BOOTSTRAP_FRESH_MS + 1);
  const result = await loadCalendarBootstrap();
  assert.equal(result.cacheSource, "memory");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 2);
});

test("refresh failure keeps prior data; miss failure throws", async () => {
  let calls = 0;
  __setCalendarBootstrapFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return payload();
    throw new Error("network down");
  });
  await loadCalendarBootstrap();
  const kept = await loadCalendarBootstrap({ force: true });
  assert.equal(kept.payload.employees[0]!.name, "Dana");

  clearCalendarBootstrap();
  __setCalendarBootstrapFetchForTests(async () => {
    throw new Error("miss fail");
  });
  await assert.rejects(() => loadCalendarBootstrap({ force: true }), /miss fail/);
});

test("logout/clear and identity isolation", async () => {
  __setCalendarBootstrapFetchForTests(async () => payload());
  await loadCalendarBootstrap();
  assert.ok(getCachedCalendarBootstrap());
  clearCalendarBootstrap();
  assert.equal(getCachedCalendarBootstrap(), null);

  __setCalendarBootstrapIdentityForTests(() => "user-a:org-a");
  await loadCalendarBootstrap();
  __setCalendarBootstrapIdentityForTests(() => "user-b:org-b");
  assert.equal(getCachedCalendarBootstrap(), null);
});

test("invalidate clears cache", async () => {
  __setCalendarBootstrapFetchForTests(async () => payload());
  await loadCalendarBootstrap();
  invalidateCalendarBootstrap();
  assert.equal(getCachedCalendarBootstrap(), null);
});
