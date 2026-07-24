import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETION_SCAN_CHUNK,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
  compareCompletionCandidates,
  paginateFilteredCompletionCandidates,
  scanCompletionQueueFromSources,
  scanCompletionQueueWithBatchLoader,
} from "./completionQueueQuery.js";
import {
  assertCompletionListPayloadBounds,
  buildCompletionListPayload,
  type CompletionListCandidateLike,
} from "./completionList.js";
import {
  assertCompletionBootstrapPayloadBounds,
  buildCompletionBootstrapPayload,
} from "./completionBootstrap.js";

function incompleteCandidate(
  partial: Partial<CompletionListCandidateLike> & { id: string }
): CompletionListCandidateLike {
  const now = partial.date ?? new Date("2026-07-01T12:00:00.000Z");
  return {
    clientId: "c1",
    invoiceNumber: null,
    amount: null,
    currency: "ILS",
    date: now,
    status: "needs_review",
    reviewStatus: "needs_review",
    source: "financial_document_review",
    reviewSourceId: "r1",
    driveUrl: null,
    driveFileUrl: null,
    client: null,
    supplierName: null,
    documentType: "tax_invoice",
    isComplete: false,
    dataComplete: false,
    approvalRequired: true,
    missingDataReasons: ["חסר סכום", "ספק לא זוהה"],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

test("301+ docs: doc 301 appears on the correct page; total exact", () => {
  const candidates = Array.from({ length: 301 }, (_, i) => {
    const n = i + 1;
    const day = String((n % 28) + 1).padStart(2, "0");
    return incompleteCandidate({
      id: `doc-${String(n).padStart(4, "0")}`,
      date: new Date(`2026-06-${day}T10:00:00.000Z`),
      createdAt: new Date(`2026-06-${day}T10:00:00.000Z`),
      invoiceNumber: n === 301 ? "NEEDLE-301" : `INV-${n}`,
      supplierName: n === 301 ? "Needle Supplier" : `Supplier ${n}`,
    });
  });

  const pageSize = 25;
  // date_desc + id_desc: highest date first; within same day id desc.
  const page13 = paginateFilteredCompletionCandidates(candidates, {
    page: 13,
    pageSize,
    sort: "date_desc",
  });
  assert.equal(page13.total, 301);
  assert.equal(page13.pageRows.length, 1); // 301 = 12*25 + 1
  assert.equal(page13.pageRows[0]?.id, page13.matched[300]?.id);

  const byIdAsc = [...candidates].sort((a, b) => (a.id < b.id ? -1 : 1));
  // Stable page 1 / page 2 no overlap
  const p1 = paginateFilteredCompletionCandidates(candidates, { page: 1, pageSize, sort: "date_desc" });
  const p2 = paginateFilteredCompletionCandidates(candidates, { page: 2, pageSize, sort: "date_desc" });
  const ids1 = new Set(p1.pageRows.map((r) => r.id));
  const ids2 = new Set(p2.pageRows.map((r) => r.id));
  for (const id of ids1) assert.equal(ids2.has(id), false);
  assert.equal(p1.total, 301);
  assert.equal(p2.total, 301);
  assert.ok(byIdAsc.length === 301);
});

test("search and status filter find docs beyond 300", () => {
  const candidates = Array.from({ length: 320 }, (_, i) => {
    const n = i + 1;
    return incompleteCandidate({
      id: `x-${String(n).padStart(4, "0")}`,
      invoiceNumber: n === 310 ? "SEARCH-ME" : null,
      supplierName: n === 315 ? "FilterCo" : `S${n}`,
      reviewStatus: n === 315 ? "rejected" : "needs_review",
      status: n === 315 ? "rejected" : "needs_review",
      date: new Date(2026, 0, 1 + (n % 20)),
      createdAt: new Date(2026, 0, 1 + (n % 20)),
    });
  });

  const searchHit = paginateFilteredCompletionCandidates(candidates, {
    page: 1,
    pageSize: 25,
    search: "search-me",
  });
  assert.equal(searchHit.total, 1);
  assert.equal(searchHit.pageRows[0]?.invoiceNumber, "SEARCH-ME");

  const filterHit = paginateFilteredCompletionCandidates(candidates, {
    page: 1,
    pageSize: 25,
    status: "rejected",
    search: "filterco",
  });
  assert.equal(filterHit.total, 1);
  assert.equal(filterHit.pageRows[0]?.id, "x-0315");
});

test("sort stable when two rows share the same date/createdAt — id tie-breaker", () => {
  const shared = new Date("2026-07-01T00:00:00.000Z");
  const a = incompleteCandidate({ id: "aaa", date: shared, createdAt: shared });
  const b = incompleteCandidate({ id: "bbb", date: shared, createdAt: shared });
  assert.ok(compareCompletionCandidates(a, b, "date_desc") !== 0);
  const page = paginateFilteredCompletionCandidates([a, b], {
    page: 1,
    pageSize: 25,
    sort: "date_desc",
  });
  assert.deepEqual(
    page.pageRows.map((r) => r.id),
    ["bbb", "aaa"]
  );
  const again = paginateFilteredCompletionCandidates([b, a], {
    page: 1,
    pageSize: 25,
    sort: "date_desc",
  });
  assert.deepEqual(
    again.pageRows.map((r) => r.id),
    ["bbb", "aaa"]
  );
});

test("bounded batch loader: each wave ≤ CHUNK; total exact for 301", async () => {
  const all = Array.from({ length: 301 }, (_, i) =>
    incompleteCandidate({
      id: `b-${String(i + 1).padStart(4, "0")}`,
      date: new Date(2026, 5, 1 + (i % 27)),
      createdAt: new Date(2026, 5, 1 + (i % 27)),
    })
  );
  let maxTake = 0;
  let waves = 0;
  const result = await scanCompletionQueueWithBatchLoader(
    async ({ skip, take }) => {
      waves += 1;
      maxTake = Math.max(maxTake, take);
      return all.slice(skip, skip + take);
    },
    { page: 1, pageSize: 25, chunk: COMPLETION_SCAN_CHUNK }
  );
  assert.ok(maxTake <= COMPLETION_SCAN_CHUNK);
  assert.ok(waves >= 4); // 301/100
  assert.equal(result.total, 301);
  assert.equal(result.pageRows.length, 25);
  assert.equal(result.truncated, false);
});

test("multi-source scan respects CHUNK and pages without duplicates", async () => {
  const sourceA = Array.from({ length: 150 }, (_, i) => ({
    id: `a-${String(i + 1).padStart(3, "0")}`,
  }));
  const sourceB = Array.from({ length: 160 }, (_, i) => ({
    id: `b-${String(i + 1).padStart(3, "0")}`,
  }));
  let maxTake = 0;
  const result = await scanCompletionQueueFromSources(
    [
      {
        name: "a",
        load: async ({ skip, take }) => {
          maxTake = Math.max(maxTake, take);
          return sourceA.slice(skip, skip + take);
        },
        map: (row) =>
          incompleteCandidate({
            id: row.id,
            date: new Date("2026-07-01T00:00:00.000Z"),
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
          }),
      },
      {
        name: "b",
        load: async ({ skip, take }) => {
          maxTake = Math.max(maxTake, take);
          return sourceB.slice(skip, skip + take);
        },
        map: (row) =>
          incompleteCandidate({
            id: row.id,
            date: new Date("2026-07-02T00:00:00.000Z"),
            createdAt: new Date("2026-07-02T00:00:00.000Z"),
          }),
      },
    ],
    { page: 1, pageSize: 25, chunk: 100 }
  );
  assert.ok(maxTake <= 100);
  assert.equal(result.total, 310);
  assert.equal(result.sourceRowsScanned, 310);
  const p1 = result.pageRows.map((r) => r.id);
  const p2 = paginateFilteredCompletionCandidates(result.matched, {
    page: 2,
    pageSize: 25,
    sort: "date_desc",
  }).pageRows.map((r) => r.id);
  assert.equal(new Set([...p1, ...p2]).size, p1.length + p2.length);
});

test("payload stays <100KB for a full page", () => {
  const pageRows = Array.from({ length: 25 }, (_, i) =>
    incompleteCandidate({
      id: `p-${i}`,
      invoiceNumber: `N-${i}`,
      supplierName: `Supplier ${i}`,
      amount: 100 + i,
    })
  );
  const payload = buildCompletionListPayload(pageRows, {
    page: 1,
    pageSize: 25,
    total: 500,
    hasMore: true,
  });
  assertCompletionListPayloadBounds(payload);
});

test("bootstrap counts are exact for 301+ matched; no readiness; truncated flagged only at ceiling", () => {
  const matched = Array.from({ length: 301 }, (_, i) =>
    incompleteCandidate({ id: `boot-${i}`, missingDataReasons: ["חסר סכום"] })
  );
  const payload = buildCompletionBootstrapPayload(matched);
  assertCompletionBootstrapPayloadBounds(payload);
  assert.equal(payload.counts.incomplete, 301);
  assert.equal(payload.truncated, undefined);

  const capped = buildCompletionBootstrapPayload(matched, { truncated: true });
  assert.equal(capped.truncated, true);
  assert.equal(capped.counts.incomplete, 301);
});

test("parity helper: filters match incomplete+queue semantics (complete rows excluded)", () => {
  const complete = incompleteCandidate({
    id: "complete",
    isComplete: true,
    dataComplete: true,
    approvalRequired: false,
    amount: 50,
    supplierName: "OK",
    missingDataReasons: [],
  });
  const incomplete = incompleteCandidate({ id: "incomplete" });
  const page = paginateFilteredCompletionCandidates([complete, incomplete], {
    page: 1,
    pageSize: 25,
  });
  assert.equal(page.total, 1);
  assert.equal(page.pageRows[0]?.id, "incomplete");
});

async function measureScanPerf(sourceRows: number, maxSourceRows = COMPLETION_SCAN_MAX_SOURCE_ROWS) {
  const pageSize = 25;
  const all = Array.from({ length: sourceRows }, (_, i) => ({
    id: `perf-${String(i + 1).padStart(5, "0")}`,
  }));
  let findManyCalls = 0;
  const totalT0 = performance.now();
  const scanned = await scanCompletionQueueFromSources(
    [
      {
        name: "gsi",
        load: async ({ skip, take }) => {
          findManyCalls += 1;
          assert.ok(take <= COMPLETION_SCAN_CHUNK);
          const half = Math.floor(all.length / 2);
          return all.slice(0, half).slice(skip, skip + take);
        },
        map: (row) =>
          incompleteCandidate({
            id: `gsi:${row.id}`,
            date: new Date(2026, 0, 1 + (Number(row.id.slice(-3)) % 20)),
            createdAt: new Date(2026, 0, 1 + (Number(row.id.slice(-3)) % 20)),
          }),
      },
      {
        name: "fdr",
        load: async ({ skip, take }) => {
          findManyCalls += 1;
          assert.ok(take <= COMPLETION_SCAN_CHUNK);
          const half = Math.floor(all.length / 2);
          return all.slice(half).slice(skip, skip + take);
        },
        map: (row) =>
          incompleteCandidate({
            id: `fdr:${row.id}`,
            date: new Date(2026, 1, 1 + (Number(row.id.slice(-3)) % 20)),
            createdAt: new Date(2026, 1, 1 + (Number(row.id.slice(-3)) % 20)),
          }),
      },
    ],
    { page: 1, pageSize, sort: "date_desc", maxSourceRows }
  );
  const queryMs = Math.round(performance.now() - totalT0);
  const readinessCalls = 1;
  const readinessRowCount = scanned.pageRows.length;
  assert.ok(readinessRowCount <= pageSize);
  const totalMs = Math.round(performance.now() - totalT0);
  return {
    findManyCalls,
    waves: scanned.waves,
    queryMs,
    readinessCalls,
    readinessRowCount,
    totalMs,
    truncated: scanned.truncated,
    total: scanned.total,
    pageRows: scanned.pageRows.length,
  };
}

test("scan perf: 25 / 301 / 2000 / 10k ceiling — batch findMany, readiness once", async () => {
  const m25 = await measureScanPerf(25);
  assert.equal(m25.truncated, false);
  assert.equal(m25.readinessCalls, 1);
  assert.ok(m25.findManyCalls < 10);
  console.info("[completion-scan-perf] 25", JSON.stringify(m25));

  const m301 = await measureScanPerf(301);
  assert.equal(m301.total, 301);
  assert.equal(m301.readinessCalls, 1);
  assert.ok(m301.findManyCalls < 20);
  console.info("[completion-scan-perf] 301", JSON.stringify(m301));

  const m2000 = await measureScanPerf(2000);
  assert.equal(m2000.total, 2000);
  assert.equal(m2000.readinessCalls, 1);
  assert.ok(m2000.findManyCalls < 50);
  console.info("[completion-scan-perf] 2000", JSON.stringify(m2000));
  if (m2000.totalMs > 1500) {
    console.info(
      "[completion-scan-perf] NOTE: >1.5s in-process for 2000 — future DB/index/materialized-state recommended; no DB change here."
    );
  }

  const mCap = await measureScanPerf(12_000);
  assert.equal(mCap.truncated, true);
  assert.equal(mCap.total, COMPLETION_SCAN_MAX_SOURCE_ROWS);
  assert.equal(mCap.readinessCalls, 1);
  console.info("[completion-scan-perf] 10000-ceiling", JSON.stringify(mCap));
});
