import assert from "node:assert/strict";
import test from "node:test";
import {
  __getLeadAdminSummaryStoreSnapshotForTests,
  __resetLeadAdminSummaryStoreForTests,
  __setLeadAdminSummaryAuthKeyForTests,
  __setLeadAdminSummaryFetchersForTests,
  clearLeadAdminSummaryCache,
  getCachedIsPlatformAdmin,
  getCachedLeadAdminSummary,
  loadIsPlatformAdmin,
  loadLeadAdminSummary,
  refreshLeadAdminSummary,
  type LeadAdminSummary,
} from "./leadAdminSummaryStore";

function summary(partial: Partial<LeadAdminSummary> = {}): LeadAdminSummary {
  return {
    newCount: partial.newCount ?? 1,
    today: partial.today ?? 1,
    week: partial.week ?? 2,
    month: partial.month ?? 3,
    qualified: partial.qualified ?? 0,
    converted: partial.converted ?? 0,
    latestCreatedAt: partial.latestCreatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

test.beforeEach(() => {
  __resetLeadAdminSummaryStoreForTests();
  __setLeadAdminSummaryAuthKeyForTests(() => "token-a");
});

test("non-admin: platform probe only — never calls marketing-leads summary", async () => {
  let summaryCalls = 0;
  __setLeadAdminSummaryFetchersForTests({
    platformAdmin: async () => ({ isPlatformAdmin: false }),
    summary: async () => {
      summaryCalls += 1;
      return summary();
    },
  });

  const [a, b] = await Promise.all([loadIsPlatformAdmin(), loadIsPlatformAdmin()]);
  assert.equal(a, false);
  assert.equal(b, false);
  assert.equal(getCachedIsPlatformAdmin(), false);

  const loaded = await Promise.all([loadLeadAdminSummary(), loadLeadAdminSummary()]);
  assert.deepEqual(loaded, [null, null]);
  assert.equal(summaryCalls, 0);
  assert.equal(getCachedLeadAdminSummary(), null);
});

test("admin: Bell+Card share one platform-admin and one summary in-flight", async () => {
  let platformCalls = 0;
  let summaryCalls = 0;
  __setLeadAdminSummaryFetchersForTests({
    platformAdmin: async () => {
      platformCalls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { isPlatformAdmin: true };
    },
    summary: async () => {
      summaryCalls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return summary({ newCount: 7 });
    },
  });

  const [adminA, adminB] = await Promise.all([loadIsPlatformAdmin(), loadIsPlatformAdmin()]);
  assert.equal(adminA, true);
  assert.equal(adminB, true);
  assert.equal(platformCalls, 1);

  const [s1, s2] = await Promise.all([loadLeadAdminSummary(), loadLeadAdminSummary()]);
  assert.equal(s1?.newCount, 7);
  assert.equal(s2?.newCount, 7);
  assert.equal(summaryCalls, 1);
  assert.equal(getCachedLeadAdminSummary()?.newCount, 7);

  // Cache hit — no extra network
  await loadLeadAdminSummary();
  assert.equal(summaryCalls, 1);
});

test("refreshLeadAdminSummary reuses in-flight and updates cache", async () => {
  let summaryCalls = 0;
  __setLeadAdminSummaryFetchersForTests({
    platformAdmin: async () => ({ isPlatformAdmin: true }),
    summary: async () => {
      summaryCalls += 1;
      return summary({ newCount: summaryCalls });
    },
  });

  await loadLeadAdminSummary();
  assert.equal(summaryCalls, 1);

  const [r1, r2] = await Promise.all([refreshLeadAdminSummary(), refreshLeadAdminSummary()]);
  assert.equal(r1?.newCount, 2);
  assert.equal(r2?.newCount, 2);
  assert.equal(summaryCalls, 2);
});

test("clearLeadAdminSummaryCache drops admin + summary caches", async () => {
  __setLeadAdminSummaryFetchersForTests({
    platformAdmin: async () => ({ isPlatformAdmin: true }),
    summary: async () => summary(),
  });
  await loadLeadAdminSummary();
  assert.equal(getCachedIsPlatformAdmin(), true);
  assert.ok(getCachedLeadAdminSummary());

  clearLeadAdminSummaryCache();
  assert.equal(getCachedIsPlatformAdmin(), null);
  assert.equal(getCachedLeadAdminSummary(), null);
  assert.equal(__getLeadAdminSummaryStoreSnapshotForTests().summaryInFlight, false);
});
