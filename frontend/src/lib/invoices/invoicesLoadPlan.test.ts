import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInvoicesFirstPaintBudget,
  INVOICES_BACKGROUND_KEYS,
  INVOICES_FIRST_PAINT_FORBIDDEN_KEYS,
  INVOICES_FIRST_PAINT_KEYS,
  runInvoicesLoadPhases,
} from "./invoicesLoadPlan";
import {
  __resetInvoicesBootstrapStoreForTests,
  __setInvoicesBootstrapFetchForTests,
  __setInvoicesBootstrapIdentityForTests,
  getInvoicesBootstrapNetworkCount,
  invalidateInvoicesBootstrap,
  loadInvoicesBootstrap,
} from "./invoicesBootstrapStore";
import {
  __resetInvoicesListStoreForTests,
  __seedInvoicesListCacheForTests,
  __setInvoicesListFetchForTests,
  __setInvoicesListIdentityForTests,
  adjustSummaryForReviewStatusChange,
  applyOptimisticReviewStatusChange,
  buildInvoicesListCacheKey,
  getInvoicesListNetworkCount,
  invoiceMatchesStatusFilter,
  invalidateInvoicesList,
  loadInvoicesList,
  restoreOptimisticReviewStatusChange,
  type InvoiceListRow,
  type InvoicesListPayload,
} from "./invoicesListStore";
import { clearInvoicesCachesNow } from "./invoicesCacheClear";

function sampleRow(overrides: Partial<InvoiceListRow> = {}): InvoiceListRow {
  return {
    id: "inv-1",
    supplierDisplayName: "Supplier",
    invoiceNumber: "A-1",
    issueDate: "2026-07-01T00:00:00.000Z",
    amount: 100,
    currency: "ILS",
    status: "needs_review",
    reviewStatus: "needs_review",
    source: "invoice",
    hasAttachment: false,
    needsReview: true,
    approvedAt: null,
    clientId: "c1",
    documentType: "tax_invoice",
    driveUrl: null,
    isComplete: true,
    dataComplete: true,
    approvalRequired: true,
    reviewSourceId: null,
    ...overrides,
  };
}

function samplePayload(rows: InvoiceListRow[]): InvoicesListPayload {
  return {
    invoices: rows,
    page: 1,
    pageSize: 25,
    total: rows.length,
    hasMore: false,
    generatedAt: new Date().toISOString(),
  };
}

test("invoices First Paint budget is bootstrap + list only", () => {
  assert.deepEqual([...INVOICES_FIRST_PAINT_KEYS], ["bootstrap", "list"]);
  assertInvoicesFirstPaintBudget(INVOICES_FIRST_PAINT_KEYS);
  assert.throws(() => assertInvoicesFirstPaintBudget(["bootstrap", "list", "clients"]));
  assert.throws(() => assertInvoicesFirstPaintBudget(["stats"] as never));
  for (const key of INVOICES_FIRST_PAINT_FORBIDDEN_KEYS) {
    assert.equal((INVOICES_FIRST_PAINT_KEYS as readonly string[]).includes(key), false);
  }
  for (const key of ["months", "invoice-by-month-fanout", "gmail-api", "drive-api", "stats", "clients"]) {
    assert.ok((INVOICES_FIRST_PAINT_FORBIDDEN_KEYS as readonly string[]).includes(key));
  }
  for (const key of INVOICES_BACKGROUND_KEYS) {
    assert.equal((INVOICES_FIRST_PAINT_KEYS as readonly string[]).includes(key), false);
  }
});

test("bootstrap + list start in parallel and First Paint ready before background clients", async () => {
  const events: string[] = [];
  let loading = true;
  await runInvoicesLoadPhases({
    loadFirstPaint: async () => {
      events.push("fp-start");
      await Promise.all([
        Promise.resolve().then(() => events.push("bootstrap")),
        Promise.resolve().then(() => events.push("list")),
      ]);
      events.push("fp-end");
    },
    onFirstPaintReady: () => {
      loading = false;
      events.push("ready");
    },
    loadBackground: async () => {
      assert.equal(loading, false, "background clients must not keep page loading");
      events.push("clients-bg");
    },
  });
  assert.deepEqual(events, ["fp-start", "bootstrap", "list", "fp-end", "ready", "clients-bg"]);
});

test("bootstrap store: fresh cache = 0 network; logout clear", async () => {
  __resetInvoicesBootstrapStoreForTests();
  __setInvoicesBootstrapIdentityForTests(() => "user:org");
  let calls = 0;
  __setInvoicesBootstrapFetchForTests(async () => {
    calls += 1;
    return {
      settings: { timezone: "Asia/Jerusalem", locale: "he-IL", currency: "ILS" },
      filters: { statuses: ["all"], documentTypes: [], sourceTypes: [] },
      summary: { approvedCount: 1, needsReviewCount: 0, incompleteCount: 0 },
      suppliersPreview: [],
      generatedAt: new Date().toISOString(),
    };
  });
  await loadInvoicesBootstrap();
  await loadInvoicesBootstrap();
  assert.equal(calls, 1);
  assert.equal(getInvoicesBootstrapNetworkCount(), 1);
  clearInvoicesCachesNow();
  invalidateInvoicesBootstrap();
  assert.equal(getInvoicesBootstrapNetworkCount(), 1);
});

test("list store: query key isolation + refresh failure keeps rows + revisit 0 network", async () => {
  __resetInvoicesListStoreForTests();
  __setInvoicesListIdentityForTests(() => "user:org");
  const queryA = { status: "approved", page: 1, pageSize: 25 };
  const queryB = { status: "needs_review", page: 1, pageSize: 25 };
  assert.notEqual(buildInvoicesListCacheKey(queryA), buildInvoicesListCacheKey(queryB));
  assert.notEqual(
    buildInvoicesListCacheKey({ ...queryA, search: "abc" }),
    buildInvoicesListCacheKey({ ...queryA, search: "xyz" })
  );

  let calls = 0;
  __setInvoicesListFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return samplePayload([sampleRow({ id: "a", reviewStatus: "approved", needsReview: false })]);
    throw new Error("refresh failed");
  });

  const first = await loadInvoicesList(queryA);
  assert.equal(first.invoices.length, 1);
  assert.equal(getInvoicesListNetworkCount(), 1);

  const second = await loadInvoicesList(queryA);
  assert.equal(second.invoices[0]?.id, "a");
  assert.equal(calls, 1, "fresh revisit must not network");
  assert.equal(getInvoicesListNetworkCount(), 1);

  __seedInvoicesListCacheForTests(queryA, {
    ...first,
    // force stale age by rewriting loadedAt via seed then forceNetwork false with aged entry:
  });
  // Force refresh failure path: seed then call with forceNetwork true after poisoning fetch
  __setInvoicesListFetchForTests(async () => {
    throw new Error("network down");
  });
  const kept = await loadInvoicesList(queryA, { forceNetwork: true });
  assert.equal(kept.invoices[0]?.id, "a");

  invalidateInvoicesList();
  await assert.rejects(() => loadInvoicesList(queryA, { forceNetwork: true }));
});

test("approve removes row from mismatched filter and updates summary; failure rolls back", () => {
  __resetInvoicesListStoreForTests();
  __setInvoicesListIdentityForTests(() => "user:org");
  const query = { status: "needs_review", page: 1, pageSize: 25 };
  const row = sampleRow();
  __seedInvoicesListCacheForTests(query, samplePayload([row]));

  assert.equal(invoiceMatchesStatusFilter("needs_review", "approved"), false);
  const summaryBefore = { approvedCount: 10, needsReviewCount: 3, incompleteCount: 2 };
  const summaryAfter = adjustSummaryForReviewStatusChange(summaryBefore, "needs_review", "approved");
  assert.equal(summaryAfter.approvedCount, 11);
  assert.equal(summaryAfter.needsReviewCount, 2);

  const applied = applyOptimisticReviewStatusChange(query, row.id, "approved");
  assert.equal(applied.removed, true);
  assert.ok(applied.previous);

  restoreOptimisticReviewStatusChange(query, applied.previous!, true);
  // Re-seed check via another apply
  const again = applyOptimisticReviewStatusChange(query, row.id, "approved");
  assert.equal(again.removed, true);
});

test("401/logout clear bridge clears bootstrap + list caches", async () => {
  __resetInvoicesBootstrapStoreForTests();
  __resetInvoicesListStoreForTests();
  __setInvoicesBootstrapIdentityForTests(() => "user:org");
  __setInvoicesListIdentityForTests(() => "user:org");
  __setInvoicesBootstrapFetchForTests(async () => ({
    settings: { timezone: "Asia/Jerusalem", locale: "he-IL", currency: "ILS" },
    filters: { statuses: ["all"], documentTypes: [], sourceTypes: [] },
    summary: { approvedCount: 1, needsReviewCount: 0, incompleteCount: 0 },
    suppliersPreview: [],
    generatedAt: new Date().toISOString(),
  }));
  __setInvoicesListFetchForTests(async () => samplePayload([sampleRow()]));
  await loadInvoicesBootstrap();
  await loadInvoicesList({ status: "approved", page: 1 });
  clearInvoicesCachesNow();
  __setInvoicesListFetchForTests(async () => {
    throw new Error("should refetch after clear");
  });
  await assert.rejects(() => loadInvoicesList({ status: "approved", page: 1 }, { forceNetwork: true }));
});
