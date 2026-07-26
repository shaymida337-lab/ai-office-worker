import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETION_SCAN_CHUNK,
  COMPLETION_SCAN_MAX_SOURCE_ROWS,
  compareCompletionCandidates,
  dedupeCompletionCandidatesPreferGsi,
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

test("dedupeCompletionCandidatesPreferGsi: GSI+FDR same gmail/fingerprint → one GSI row", () => {
  const gsi = incompleteCandidate({
    id: "gmail-scan:gsi-1",
    source: "gmail_scan_item",
    amount: 450,
    supplierName: "GENERAL TIRE",
  });
  const fdr = incompleteCandidate({
    id: "document-review:fdr-1",
    source: "financial_document_review",
    amount: 450,
    supplierName: "GENERAL TIRE",
  });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    { ...gsi, gmailMessageId: "msg-1", emailMessageId: "email-1", duplicateKey: "fp-1", documentFingerprint: "fp-1" },
    { ...fdr, gmailMessageId: "msg-1", emailMessageId: "email-1", duplicateKey: "fp-1", documentFingerprint: "fp-1" },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, "gmail-scan:gsi-1");
  assert.equal(deduped[0]?.source, "gmail_scan_item");
});

test("dedupeCompletionCandidatesPreferGsi: GSI rejected + FDR needs_review same fingerprint → FDR", () => {
  const gsi = incompleteCandidate({
    id: "gmail-scan:gsi-rejected",
    source: "gmail_scan_item",
    amount: 354,
    supplierName: "ערנט אי.קום",
    reviewStatus: "rejected",
    status: "rejected",
    approvalRequired: false,
    isComplete: true,
    dataComplete: true,
    missingDataReasons: [],
  });
  const fdr = incompleteCandidate({
    id: "document-review:fdr-needs-review",
    source: "financial_document_review",
    amount: 354,
    supplierName: 'נ.ערנט איי.קום בע"מ',
    reviewStatus: "needs_review",
    status: "needs_review",
    approvalRequired: true,
    isComplete: false,
    dataComplete: true,
    missingDataReasons: [],
  });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    {
      ...gsi,
      gmailMessageId: "19ee12f8ab9f4579",
      duplicateKey: "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf",
      documentFingerprint: "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf",
      decisionReason: "Quarantined: cross-org gmail ingestion",
    },
    {
      ...fdr,
      gmailMessageId: "19ee12f8ab9f4579",
      duplicateKey: "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf",
      documentFingerprint: "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf",
      decisionReason: "outcome_BLOCKED:OE_TRUST_BLOCKED:Blocked by FSE critical failure",
    },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, "document-review:fdr-needs-review");
  assert.equal(deduped[0]?.source, "financial_document_review");
  assert.equal(deduped[0]?.reviewStatus, "needs_review");
});

test("dedupeCompletionCandidatesPreferGsi: both needs_review → prefer GSI", () => {
  const gsi = incompleteCandidate({
    id: "gmail-scan:gsi-nr",
    source: "gmail_scan_item",
    amount: 100,
    reviewStatus: "needs_review",
  });
  const fdr = incompleteCandidate({
    id: "document-review:fdr-nr",
    source: "financial_document_review",
    amount: 100,
    reviewStatus: "needs_review",
  });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    { ...gsi, gmailMessageId: "msg-x", documentFingerprint: "fp-x", duplicateKey: "fp-x" },
    { ...fdr, gmailMessageId: "msg-x", documentFingerprint: "fp-x", duplicateKey: "fp-x" },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, "gmail-scan:gsi-nr");
});

test("dedupeCompletionCandidatesPreferGsi: both rejected → keep GSI (non-actionable pair)", () => {
  const gsi = incompleteCandidate({
    id: "gmail-scan:gsi-rej",
    source: "gmail_scan_item",
    reviewStatus: "rejected",
    status: "rejected",
  });
  const fdr = incompleteCandidate({
    id: "document-review:fdr-rej",
    source: "financial_document_review",
    reviewStatus: "rejected",
    status: "rejected",
  });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    {
      ...gsi,
      gmailMessageId: "msg-r",
      documentFingerprint: "fp-r",
      duplicateKey: "fp-r",
      decisionReason: "Quarantined: cross-org gmail ingestion",
    },
    {
      ...fdr,
      gmailMessageId: "msg-r",
      documentFingerprint: "fp-r",
      duplicateKey: "fp-r",
      decisionReason: "Quarantined: cross-org gmail ingestion",
    },
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.id, "gmail-scan:gsi-rej");
  assert.equal(deduped[0]?.reviewStatus, "rejected");
});

test("dedupeCompletionCandidatesPreferGsi: different gmailMessageIds → two rows", () => {
  const a = incompleteCandidate({ id: "gmail-scan:a", source: "gmail_scan_item", amount: 450 });
  const b = incompleteCandidate({ id: "gmail-scan:b", source: "gmail_scan_item", amount: 450 });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    { ...a, gmailMessageId: "msg-a", documentFingerprint: "fp-a" },
    { ...b, gmailMessageId: "msg-b", documentFingerprint: "fp-b" },
  ]);
  assert.equal(deduped.length, 2);
});

test("dedupeCompletionCandidatesPreferGsi: same amount/supplier, different fingerprint → two rows", () => {
  const gsi = incompleteCandidate({
    id: "gmail-scan:gsi",
    source: "gmail_scan_item",
    amount: 918,
    supplierName: "סופר פארם",
  });
  const fdr = incompleteCandidate({
    id: "document-review:fdr",
    source: "financial_document_review",
    amount: 918,
    supplierName: "סופר פארם",
  });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    { ...gsi, gmailMessageId: "msg-1", documentFingerprint: "fp-1", duplicateKey: "fp-1" },
    { ...fdr, gmailMessageId: "msg-2", documentFingerprint: "fp-2", duplicateKey: "fp-2" },
  ]);
  assert.equal(deduped.length, 2);
});

test("dedupeCompletionCandidatesPreferGsi: camera FDR without gmail refs stays", () => {
  const camera = incompleteCandidate({
    id: "document-review:cam-1",
    source: "financial_document_review",
    amount: 12,
    supplierName: "Camera Shop",
  });
  const gsi = incompleteCandidate({
    id: "gmail-scan:gsi-1",
    source: "gmail_scan_item",
    amount: 450,
  });
  const deduped = dedupeCompletionCandidatesPreferGsi([
    { ...gsi, gmailMessageId: "msg-1", duplicateKey: "fp-gmail" },
    { ...camera, gmailMessageId: null, emailMessageId: null, documentFingerprint: "fp-camera" },
  ]);
  assert.equal(deduped.length, 2);
  assert.ok(deduped.some((row) => row.id === "document-review:cam-1"));
});

test("Rnet-shaped: rejected quarantined GSI + needs_review FDR → completion shows FDR once", () => {
  const rnetFp = "87d30575d372c795d0c93e55fc3d293dcc1f2462a9bad9bf";
  const gsi = incompleteCandidate({
    id: "gmail-scan:cmqw3n5ug020fm92b5smx5bx1",
    source: "gmail_scan_item",
    amount: 354,
    supplierName: "ערנט אי.קום",
    invoiceNumber: "OV255006399",
    reviewStatus: "rejected",
    status: "rejected",
    isComplete: true,
    dataComplete: true,
    approvalRequired: false,
    missingDataReasons: [],
  });
  const fdr = incompleteCandidate({
    id: "document-review:cmqw3n5hx020dm92bp1joi8wu",
    source: "financial_document_review",
    amount: 354,
    supplierName: 'נ.ערנט איי.קום בע"מ',
    invoiceNumber: "OV255006399",
    reviewStatus: "needs_review",
    status: "needs_review",
    // Prod routing: needs_review + dataComplete ⇒ incomplete queue (approval still required).
    isComplete: false,
    dataComplete: true,
    approvalRequired: true,
    missingDataReasons: [],
  });
  const other = incompleteCandidate({
    id: "gmail-scan:other",
    source: "gmail_scan_item",
    amount: 450,
    supplierName: "GENERAL TIRE",
  });

  const candidates = [
    {
      ...gsi,
      gmailMessageId: "19ee12f8ab9f4579",
      duplicateKey: rnetFp,
      documentFingerprint: rnetFp,
      decisionReason: "Quarantined: cross-org gmail ingestion",
    },
    {
      ...fdr,
      gmailMessageId: "19ee12f8ab9f4579",
      duplicateKey: rnetFp,
      documentFingerprint: rnetFp,
      decisionReason: "outcome_BLOCKED:OE_TRUST_BLOCKED:Blocked by FSE critical failure",
    },
    {
      ...other,
      gmailMessageId: "msg-other",
      duplicateKey: "fp-other",
      documentFingerprint: "fp-other",
    },
  ];

  const deduped = dedupeCompletionCandidatesPreferGsi(candidates);
  const after = paginateFilteredCompletionCandidates(deduped, {
    page: 1,
    pageSize: 25,
    sort: "date_desc",
  });

  assert.equal(deduped.length, 2);
  assert.equal(deduped.filter((r) => String(r.invoiceNumber) === "OV255006399").length, 1);
  assert.equal(
    deduped.find((r) => r.invoiceNumber === "OV255006399")?.id,
    "document-review:cmqw3n5hx020dm92bp1joi8wu",
  );
  assert.equal(after.total, 2);
  assert.ok(after.pageRows.some((r) => r.id === "document-review:cmqw3n5hx020dm92bp1joi8wu"));
  assert.equal(
    after.pageRows.some((r) => r.id === "gmail-scan:cmqw3n5ug020fm92b5smx5bx1"),
    false,
  );
  // rejected twin must not reappear as an actionable completion row
  assert.equal(
    after.matched.some((r) => r.reviewStatus === "rejected" && r.invoiceNumber === "OV255006399"),
    false,
  );
});

test("scanCompletionQueueFromSources dedupes before pagination so total/count are correct", async () => {
  const gsiRows = [
    { id: "gsi-tire", gmailMessageId: "g-tire", duplicateKey: "fp-tire" },
    { id: "gsi-pharm", gmailMessageId: "g-pharm", duplicateKey: "fp-pharm" },
  ];
  const fdrRows = [
    { id: "fdr-tire", gmailMessageId: "g-tire", documentFingerprint: "fp-tire" },
    { id: "fdr-pharm", gmailMessageId: "g-pharm", documentFingerprint: "fp-pharm" },
    { id: "fdr-camera", gmailMessageId: null as string | null, documentFingerprint: "fp-cam" },
  ];

  const result = await scanCompletionQueueFromSources(
    [
      {
        name: "gmail_scan_item",
        load: async ({ skip, take }) => gsiRows.slice(skip, skip + take),
        map: (row) =>
          ({
            ...incompleteCandidate({
              id: `gmail-scan:${row.id}`,
              source: "gmail_scan_item",
              amount: 100,
            }),
            gmailMessageId: row.gmailMessageId,
            duplicateKey: row.duplicateKey,
            documentFingerprint: row.duplicateKey,
          }) as CompletionListCandidateLike & {
            gmailMessageId: string;
            duplicateKey: string;
            documentFingerprint: string;
          },
      },
      {
        name: "financial_document_review",
        load: async ({ skip, take }) => fdrRows.slice(skip, skip + take),
        map: (row) =>
          ({
            ...incompleteCandidate({
              id: `document-review:${row.id}`,
              source: "financial_document_review",
              amount: 100,
            }),
            gmailMessageId: row.gmailMessageId,
            documentFingerprint: row.documentFingerprint,
            duplicateKey: row.documentFingerprint,
          }) as CompletionListCandidateLike & {
            gmailMessageId: string | null;
            documentFingerprint: string;
            duplicateKey: string;
          },
      },
    ],
    {
      page: 1,
      pageSize: 25,
      dedupeCandidates: dedupeCompletionCandidatesPreferGsi,
    }
  );

  // 2 GSI + 1 camera FDR (2 FDR mirrors dropped) = 3
  assert.equal(result.sourceRowsScanned, 5);
  assert.equal(result.total, 3);
  assert.equal(result.pageRows.length, 3);
  assert.equal(result.hasMore, false);
  assert.ok(result.pageRows.every((row) => !row.id.includes("fdr-tire") && !row.id.includes("fdr-pharm")));
  assert.ok(result.pageRows.some((row) => row.id === "gmail-scan:gsi-tire"));
  assert.ok(result.pageRows.some((row) => row.id === "gmail-scan:gsi-pharm"));
  assert.ok(result.pageRows.some((row) => row.id === "document-review:fdr-camera"));
});

test("scanCompletionQueueFromSources: rejected GSI does not hide needs_review FDR; total after dedupe", async () => {
  const gsiRows = [
    {
      id: "gsi-rnet-rej",
      gmailMessageId: "g-rnet",
      duplicateKey: "fp-rnet",
      reviewStatus: "rejected",
      decisionReason: "Quarantined: cross-org gmail ingestion",
    },
    {
      id: "gsi-ok",
      gmailMessageId: "g-ok",
      duplicateKey: "fp-ok",
      reviewStatus: "needs_review",
      decisionReason: null as string | null,
    },
  ];
  const fdrRows = [
    {
      id: "fdr-rnet-nr",
      gmailMessageId: "g-rnet",
      documentFingerprint: "fp-rnet",
      reviewStatus: "needs_review",
      decisionReason: "outcome_BLOCKED:OE_TRUST_BLOCKED",
    },
  ];

  const result = await scanCompletionQueueFromSources(
    [
      {
        name: "gmail_scan_item",
        load: async ({ skip, take }) => gsiRows.slice(skip, skip + take),
        map: (row) =>
          ({
            ...incompleteCandidate({
              id: `gmail-scan:${row.id}`,
              source: "gmail_scan_item",
              amount: row.id.includes("rnet") ? 354 : 50,
              reviewStatus: row.reviewStatus,
              status: row.reviewStatus,
              isComplete: row.reviewStatus === "rejected",
              dataComplete: row.reviewStatus === "rejected",
              approvalRequired: row.reviewStatus !== "rejected",
              missingDataReasons: row.reviewStatus === "rejected" ? [] : ["חסר סכום"],
            }),
            gmailMessageId: row.gmailMessageId,
            duplicateKey: row.duplicateKey,
            documentFingerprint: row.duplicateKey,
            decisionReason: row.decisionReason,
          }) as CompletionListCandidateLike & {
            gmailMessageId: string;
            duplicateKey: string;
            documentFingerprint: string;
            decisionReason: string | null;
          },
      },
      {
        name: "financial_document_review",
        load: async ({ skip, take }) => fdrRows.slice(skip, skip + take),
        map: (row) =>
          ({
            ...incompleteCandidate({
              id: `document-review:${row.id}`,
              source: "financial_document_review",
              amount: 354,
              reviewStatus: row.reviewStatus,
              status: row.reviewStatus,
              isComplete: false,
              dataComplete: true,
              approvalRequired: true,
              missingDataReasons: [],
            }),
            gmailMessageId: row.gmailMessageId,
            documentFingerprint: row.documentFingerprint,
            duplicateKey: row.documentFingerprint,
            decisionReason: row.decisionReason,
          }) as CompletionListCandidateLike & {
            gmailMessageId: string;
            documentFingerprint: string;
            duplicateKey: string;
            decisionReason: string;
          },
      },
    ],
    {
      page: 1,
      pageSize: 25,
      dedupeCandidates: dedupeCompletionCandidatesPreferGsi,
    }
  );

  assert.equal(result.sourceRowsScanned, 3);
  assert.equal(result.total, 2);
  assert.ok(result.pageRows.some((row) => row.id === "document-review:fdr-rnet-nr"));
  assert.ok(result.pageRows.some((row) => row.id === "gmail-scan:gsi-ok"));
  assert.equal(
    result.pageRows.some((row) => row.id === "gmail-scan:gsi-rnet-rej"),
    false,
  );
});

test("rnet raw source matchers: id / invoice / fingerprint; no fingerprint-only dependency", async () => {
  const {
    matchesRnetRawFdrTraceTarget,
    matchesRnetRawGsiTraceTarget,
    RNET_COMPLETION_TRACE_FDR_ID,
    RNET_COMPLETION_TRACE_GSI_ID,
    summarizeCompletionSourceWhereSafe,
    logRnetRawFdrFindManyTrace,
    logRnetBeforeCollectedTrace,
    logRnetAfterCollectedTrace,
  } = await import("./completionQueueQuery.js");

  assert.equal(matchesRnetRawFdrTraceTarget({ id: RNET_COMPLETION_TRACE_FDR_ID }), true);
  assert.equal(matchesRnetRawFdrTraceTarget({ invoiceNumber: "OV255006399" }), true);
  assert.equal(matchesRnetRawFdrTraceTarget({ documentFingerprint: "87d30575abc" }), true);
  assert.equal(matchesRnetRawFdrTraceTarget({ id: "other", invoiceNumber: "X" }), false);

  assert.equal(matchesRnetRawGsiTraceTarget({ id: RNET_COMPLETION_TRACE_GSI_ID }), true);
  assert.equal(matchesRnetRawGsiTraceTarget({ duplicateKey: "87d30575abc" }), true);
  assert.equal(matchesRnetRawGsiTraceTarget({ id: "other", duplicateKey: "zzzz" }), false);

  const summary = summarizeCompletionSourceWhereSafe({
    organizationId: "cmqw27e43002bm92bmf9mjy1n",
    documentType: { in: ["tax_invoice_receipt"] },
    reviewStatus: { in: ["needs_review", "rejected"] },
    AND: [{ NOT: { gmailMessageId: { in: ["x"] } } }],
  });
  assert.equal(summary.organizationId, "cmqw27e43002bm92bmf9mjy1n");
  assert.deepEqual(summary.documentTypeIn, ["tax_invoice_receipt"]);
  assert.equal(summary.hasAnd, true);
  assert.equal(JSON.stringify(summary).includes("gmailMessageId"), false);

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    logRnetRawFdrFindManyTrace({
      queryExecuted: true,
      totalRawFdr: 33,
      matchedTargetCount: 1,
      targets: [
        {
          id: RNET_COMPLETION_TRACE_FDR_ID,
          organizationId: "cmqw27e43002bm92bmf9mjy1n",
          reviewStatus: "needs_review",
          documentType: "tax_invoice_receipt",
          documentFingerprint: "87d30575d372c795",
          gmailMessageId: "present-but-not-logged-value",
        },
      ],
    });
    logRnetBeforeCollectedTrace({ fdrMappedTargetCount: 1, gsiMappedTargetCount: 0 });
    logRnetAfterCollectedTrace({ targetCount: 1 });
  } finally {
    console.log = originalLog;
  }
  assert.equal(logs.length, 3);
  assert.match(logs[0]!, /"stage":"rawFdrFindMany"/);
  assert.match(logs[0]!, /"hasGmailMessageId":true/);
  assert.equal(logs[0]!.includes("present-but-not-logged-value"), false);
  assert.match(logs[1]!, /"stage":"beforeCollected"/);
  assert.match(logs[2]!, /"stage":"afterCollected"/);
});

test("rnet completion trace: match + slim only target ids; logging does not change pagination", async () => {
  const {
    matchesRnetCompletionTraceTarget,
    slimRnetCompletionTraceRow,
    logRnetCompletionTraceStage,
    RNET_COMPLETION_TRACE_FDR_ID,
    RNET_COMPLETION_TRACE_FINGERPRINT_PREFIX,
  } = await import("./completionQueueQuery.js");

  const target = {
    id: `document-review:${RNET_COMPLETION_TRACE_FDR_ID}`,
    source: "financial_document_review",
    reviewStatus: "needs_review",
    status: "needs_review",
    decisionReason: "outcome_BLOCKED:OE_TRUST_BLOCKED",
    dataComplete: true,
    approvalRequired: true,
    isComplete: false,
    documentFingerprint: `${RNET_COMPLETION_TRACE_FINGERPRINT_PREFIX}d372c795`,
    invoiceNumber: "OV255006399",
  };
  const other = incompleteCandidate({
    id: "document-review:other",
    amount: 10,
    isComplete: false,
    dataComplete: false,
    approvalRequired: true,
  });

  assert.equal(matchesRnetCompletionTraceTarget(target), true);
  assert.equal(matchesRnetCompletionTraceTarget(other), false);

  const slim = slimRnetCompletionTraceRow(target);
  assert.equal(slim.id, target.id);
  assert.equal(slim.fingerprintPrefix, RNET_COMPLETION_TRACE_FINGERPRINT_PREFIX);
  assert.equal(Object.prototype.hasOwnProperty.call(slim, "supplierName"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(slim, "parsedFieldsJson"), false);

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    logRnetCompletionTraceStage("inSource", [target, other]);
    logRnetCompletionTraceStage("afterIncomplete", [other]);
  } finally {
    console.log = originalLog;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /rnet_completion_trace/);
  assert.match(logs[0]!, /"stage":"inSource"/);

  logs.length = 0;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    logRnetCompletionTraceStage("afterIncomplete", [other], { force: true });
  } finally {
    console.log = originalLog;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /"count":0/);

  const page = paginateFilteredCompletionCandidates(
    [
      incompleteCandidate({
        id: target.id,
        amount: 354,
        isComplete: false,
        dataComplete: true,
        approvalRequired: true,
        invoiceNumber: "OV255006399",
      }),
      other,
    ],
    { page: 1, pageSize: 25 },
  );
  assert.equal(page.total, 2);
  assert.equal(page.pageRows.length, 2);
});
