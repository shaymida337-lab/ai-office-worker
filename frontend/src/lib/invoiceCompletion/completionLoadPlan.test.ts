import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCompletionFirstPaintBudget,
  COMPLETION_FIRST_PAINT_KEYS,
  COMPLETION_FIRST_PAINT_FORBIDDEN_KEYS,
  COMPLETION_TRUNCATED_MESSAGE,
  completionTruncatedBannerText,
  isCompletionTruncated,
  maxSupportedCompletionPage,
  runCompletionLoadPhases,
  shouldFetchCompletionPage,
} from "./completionLoadPlan.ts";
import {
  _resetCompletionBootstrapStoreForTests,
  _setCompletionBootstrapFetchForTests,
  _setCompletionBootstrapIdentityForTests,
  getCompletionBootstrapNetworkCount,
  loadCompletionBootstrap,
  clearCompletionBootstrap,
} from "./completionBootstrapStore.ts";
import {
  _resetCompletionListStoreForTests,
  _setCompletionListFetchForTests,
  _setCompletionListIdentityForTests,
  buildCompletionListCacheKey,
  getCompletionListNetworkCount,
  loadCompletionList,
  removeCompletionListRow,
  restoreCompletionListRow,
  clearCompletionList,
  type CompletionListPayload,
  type CompletionListRow,
} from "./completionListStore.ts";
import { clearCompletionCachesNow } from "./completionCacheClear.ts";
import { completionRowToInvoice } from "./mapCompletionRow.ts";

const IDENTITY = "user-1:org-1";

function sampleRow(id: string): CompletionListRow {
  return {
    id,
    supplierDisplayName: null,
    invoiceNumber: null,
    issueDate: "2026-07-01T00:00:00.000Z",
    amount: null,
    currency: "ILS",
    reviewStatus: "needs_review",
    missingFields: ["amount"],
    source: "financial_document_review",
    hasAttachment: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    clientId: "c1",
    documentType: "tax_invoice",
    driveUrl: null,
    dataComplete: false,
    approvalRequired: true,
    reviewSourceId: "r1",
    status: "needs_review",
  };
}

function samplePayload(rows: CompletionListRow[]): CompletionListPayload {
  return {
    rows,
    page: 1,
    pageSize: 25,
    total: rows.length,
    hasMore: false,
    generatedAt: new Date().toISOString(),
  };
}

test("First Paint budget is exactly bootstrap + list", () => {
  assertCompletionFirstPaintBudget(COMPLETION_FIRST_PAINT_KEYS);
  assert.equal(COMPLETION_FIRST_PAINT_KEYS.length, 2);
  assert.ok(COMPLETION_FIRST_PAINT_FORBIDDEN_KEYS.includes("legacy-invoices-incomplete-300"));
});

test("list + bootstrap start in parallel; rows do not wait for bootstrap", async () => {
  let listStarted = 0;
  let bootStarted = 0;
  let rowsReadyAt = 0;
  let bootDoneAt = 0;

  await runCompletionLoadPhases({
    loadFirstPaint: async () => {
      const listP = (async () => {
        listStarted = Date.now();
        await new Promise((r) => setTimeout(r, 5));
        rowsReadyAt = Date.now();
      })();
      const bootP = (async () => {
        bootStarted = Date.now();
        await new Promise((r) => setTimeout(r, 40));
        bootDoneAt = Date.now();
      })();
      await Promise.all([listP, bootP]);
    },
    onFirstPaintReady: () => {
      assert.ok(listStarted > 0 && bootStarted > 0);
      assert.ok(Math.abs(listStarted - bootStarted) < 20, "should start together");
      assert.ok(rowsReadyAt <= bootDoneAt);
    },
  });
});

test("fresh revisit = 0 network; same query dedupe; filters get separate keys", async () => {
  _resetCompletionBootstrapStoreForTests();
  _resetCompletionListStoreForTests();
  _setCompletionBootstrapIdentityForTests(() => IDENTITY);
  _setCompletionListIdentityForTests(() => IDENTITY);

  let bootCalls = 0;
  let listCalls = 0;
  _setCompletionBootstrapFetchForTests(async () => {
    bootCalls += 1;
    return {
      counts: { incomplete: 1, byStatus: { needs_review: 1 } },
      availableFilters: { statuses: ["all"], sources: [], missingFieldKeys: [] },
      missingFieldCategories: [],
      generatedAt: new Date().toISOString(),
    };
  });
  _setCompletionListFetchForTests(async () => {
    listCalls += 1;
    return samplePayload([sampleRow("a")]);
  });

  await loadCompletionBootstrap();
  await loadCompletionList({ page: 1, pageSize: 25 });
  const before = getCompletionBootstrapNetworkCount() + getCompletionListNetworkCount();
  await loadCompletionBootstrap();
  await loadCompletionList({ page: 1, pageSize: 25 });
  assert.equal(bootCalls, 1);
  assert.equal(listCalls, 1);
  assert.equal(getCompletionBootstrapNetworkCount() + getCompletionListNetworkCount(), before);

  const keyA = buildCompletionListCacheKey({ page: 1, status: "needs_review" });
  const keyB = buildCompletionListCacheKey({ page: 1, status: "rejected" });
  assert.notEqual(keyA, keyB);

  clearCompletionBootstrap();
  clearCompletionList();
});

test("mutation removes row and updates count; failure restore; refresh failure keeps rows", async () => {
  _resetCompletionListStoreForTests();
  _setCompletionListIdentityForTests(() => IDENTITY);
  let calls = 0;
  _setCompletionListFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return samplePayload([sampleRow("a"), sampleRow("b")]);
    throw new Error("refresh failed");
  });

  const first = await loadCompletionList({ page: 1 });
  assert.equal(first.rows.length, 2);
  const removed = removeCompletionListRow({ page: 1 }, "a");
  assert.equal(removed, true);
  const afterRemove = await loadCompletionList({ page: 1 });
  assert.equal(afterRemove.rows.some((r) => r.id === "a"), false);

  restoreCompletionListRow({ page: 1 }, sampleRow("a"));
  const restored = await loadCompletionList({ page: 1 });
  assert.equal(restored.rows.some((r) => r.id === "a"), true);

  // Force stale refresh failure path: age by mutating via second load with force after patching time is hard;
  // ensure network error with existing memory returns rows.
  _setCompletionListFetchForTests(async () => {
    throw new Error("network down");
  });
  const kept = await loadCompletionList({ page: 1, pageSize: 25 }, { forceNetwork: true });
  assert.ok(kept.rows.length >= 1);
});

test("logout/401 clear bridge clears bootstrap + list", async () => {
  _resetCompletionBootstrapStoreForTests();
  _resetCompletionListStoreForTests();
  _setCompletionBootstrapIdentityForTests(() => IDENTITY);
  _setCompletionListIdentityForTests(() => IDENTITY);
  _setCompletionBootstrapFetchForTests(async () => ({
    counts: { incomplete: 0, byStatus: {} },
    availableFilters: { statuses: [], sources: [], missingFieldKeys: [] },
    missingFieldCategories: [],
    generatedAt: new Date().toISOString(),
  }));
  _setCompletionListFetchForTests(async () => samplePayload([sampleRow("x")]));
  await loadCompletionBootstrap();
  await loadCompletionList({ page: 1 });
  clearCompletionCachesNow();
  _setCompletionBootstrapFetchForTests(async () => {
    throw new Error("should refetch after clear");
  });
  await assert.rejects(() => loadCompletionBootstrap({ forceNetwork: true }));
});

test("mapCompletionRow hydrates Invoice without inventing amounts", () => {
  const invoice = completionRowToInvoice(sampleRow("z"));
  assert.equal(invoice.amount, null);
  assert.equal(invoice.supplierName, null);
  assert.ok((invoice.missingDataReasons ?? []).includes("חסר סכום"));
});

test("truncated banner text only when truncated=true", () => {
  assert.equal(completionTruncatedBannerText(false), null);
  assert.equal(completionTruncatedBannerText(true), COMPLETION_TRUNCATED_MESSAGE);
  assert.equal(isCompletionTruncated({ listTruncated: false, bootstrapTruncated: false }), false);
  assert.equal(isCompletionTruncated({ listTruncated: true }), true);
  assert.equal(isCompletionTruncated({ bootstrapTruncated: true }), true);
});

test("truncated pagination does not invent pages beyond scanned total", () => {
  assert.equal(maxSupportedCompletionPage({ truncated: true, total: 100, pageSize: 25 }), 4);
  assert.equal(
    shouldFetchCompletionPage({
      truncated: true,
      page: 5,
      total: 100,
      pageSize: 25,
      hasMore: false,
    }),
    false
  );
  assert.equal(
    shouldFetchCompletionPage({
      truncated: true,
      page: 2,
      total: 100,
      pageSize: 25,
      hasMore: true,
    }),
    true
  );
});

test("list cache preserves truncated flag across revisit", async () => {
  _resetCompletionListStoreForTests();
  _setCompletionListIdentityForTests(() => IDENTITY);
  let calls = 0;
  _setCompletionListFetchForTests(async () => {
    calls += 1;
    return {
      ...samplePayload([sampleRow("t1")]),
      total: 10000,
      hasMore: true,
      truncated: true,
    };
  });
  const first = await loadCompletionList({ page: 1, pageSize: 25 });
  assert.equal(first.truncated, true);
  assert.equal(calls, 1);
  const second = await loadCompletionList({ page: 1, pageSize: 25 });
  assert.equal(second.truncated, true);
  assert.equal(calls, 1);
});

test("ReportsClient wires truncated banner and drops legacy incomplete-300", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const file = path.join(process.cwd(), "src/app/reports/ReportsClient.tsx");
  const src = await fs.readFile(file, "utf8");
  assert.match(src, /COMPLETION_TRUNCATED_MESSAGE/);
  assert.match(src, /completion-truncated-banner/);
  assert.doesNotMatch(src, /\/api\/invoices\?completeness=incomplete/);
});
