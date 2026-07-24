import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCompletionBootstrapPayloadBounds,
  buildCompletionBootstrapPayload,
} from "./completionBootstrap.js";
import {
  assertCompletionListPayloadBounds,
  buildCompletionListPayload,
  clampCompletionListPage,
  clampCompletionListPageSize,
  COMPLETION_LIST_FORBIDDEN_RESPONSE_KEYS,
  filterCompletionCandidatesBySearch,
  filterCompletionCandidatesByStatus,
  mapCandidateToCompletionRow,
  sliceCompletionPage,
  type CompletionListCandidateLike,
} from "./completionList.js";
import { COMPLETION_SCAN_CHUNK, COMPLETION_SCAN_MAX_SOURCE_ROWS } from "./completionQueueQuery.js";
import {
  _resetCompletionBootstrapCacheForTests,
  getCompletionBootstrapCacheGeneration,
  peekCompletionBootstrapCache,
  setCompletionBootstrapCache,
  invalidateCompletionBootstrap,
} from "./completionBootstrapCache.js";
import { isAllowedInvoiceCompletionRead } from "../p0/financialContainment.js";
import { computeCompletionUnaccountedMs } from "../../lib/invoiceCompletionEndpointTiming.js";

function candidate(partial: Partial<CompletionListCandidateLike> & { id: string }): CompletionListCandidateLike {
  const now = new Date("2026-07-01T12:00:00.000Z");
  return {
    clientId: "c1",
    invoiceNumber: null,
    amount: 100,
    currency: "ILS",
    date: now,
    status: "needs_review",
    reviewStatus: "needs_review",
    source: "financial_document_review",
    reviewSourceId: "r1",
    driveUrl: "https://drive.example/file",
    driveFileUrl: null,
    client: { id: "c1", name: "Acme", color: null },
    supplierName: "Acme",
    documentType: "tax_invoice",
    isComplete: false,
    dataComplete: false,
    approvalRequired: true,
    missingDataReasons: ["חסר סכום"],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

test("pagination clamps pageSize default 25 max 100; scan bounds replace old 300 cap", () => {
  assert.equal(clampCompletionListPageSize(undefined), 25);
  assert.equal(clampCompletionListPageSize(0), 25);
  assert.equal(clampCompletionListPageSize(200), 100);
  assert.equal(clampCompletionListPage(0), 1);
  assert.equal(COMPLETION_SCAN_CHUNK, 100);
  assert.ok(COMPLETION_SCAN_MAX_SOURCE_ROWS > 300);
});

test("list payload field whitelist — no OCR/history/body", () => {
  const rows = [candidate({ id: "a" }), candidate({ id: "b", amount: null, missingDataReasons: ["ספק לא זוהה"] })];
  const slice = sliceCompletionPage(rows, { page: 1, pageSize: 25 });
  const payload = buildCompletionListPayload(slice.pageRows, {
    page: slice.page,
    pageSize: slice.pageSize,
    total: slice.total,
    hasMore: slice.hasMore,
  });
  assertCompletionListPayloadBounds(payload);
  assert.equal(payload.rows.length, 2);
  const row = payload.rows[0]!;
  assert.ok(row.id);
  assert.ok("supplierDisplayName" in row);
  assert.ok("missingFields" in row);
  assert.ok("hasAttachment" in row);
  assert.ok("createdAt" in row);
  for (const key of COMPLETION_LIST_FORBIDDEN_RESPONSE_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, key), false);
  }
  const json = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(json, "utf8") < 100 * 1024);
  assert.doesNotMatch(json, /parsedFieldsJson|rawAnalysis|ocrText|emailBody|histories/);
});

test("missing supplier maps to missingFields without fake zeros", () => {
  const row = mapCandidateToCompletionRow(
    candidate({
      id: "m",
      supplierName: null,
      client: null,
      amount: null,
      missingDataReasons: ["ספק לא זוהה", "חסר סכום"],
    })
  );
  assert.equal(row.supplierDisplayName, null);
  assert.equal(row.amount, null);
  assert.deepEqual(row.missingFields.sort(), ["amount", "supplier"]);
});

test("status and search filters", () => {
  const rows = [
    candidate({ id: "1", reviewStatus: "needs_review", supplierName: "Alpha" }),
    candidate({ id: "2", reviewStatus: "rejected", supplierName: "Beta", invoiceNumber: "INV-9" }),
  ];
  assert.equal(filterCompletionCandidatesByStatus(rows, "needs_review").length, 1);
  assert.equal(filterCompletionCandidatesBySearch(rows, "inv-9").length, 1);
  assert.equal(filterCompletionCandidatesBySearch(rows, "alpha").length, 1);
});

test("bootstrap has counts/filters/missing categories, no rows", () => {
  const payload = buildCompletionBootstrapPayload([
    candidate({ id: "1", missingDataReasons: ["חסר סכום"] }),
    candidate({ id: "2", missingDataReasons: ["ספק לא זוהה"] }),
  ]);
  assertCompletionBootstrapPayloadBounds(payload);
  assert.equal(payload.counts.incomplete, 2);
  assert.equal(payload.counts.byStatus.needs_review, 2);
  assert.ok(payload.availableFilters.statuses.includes("needs_review"));
  assert.ok(payload.missingFieldCategories.some((c) => c.key === "amount" && c.count === 1));
  assert.equal("rows" in payload, false);
});

test("bootstrap cache isolation + invalidation", () => {
  _resetCompletionBootstrapCacheForTests();
  const payload = buildCompletionBootstrapPayload([candidate({ id: "1" })]);
  const gen = getCompletionBootstrapCacheGeneration("u1", "org1");
  setCompletionBootstrapCache({
    userId: "u1",
    organizationId: "org1",
    payload,
    generationAtStart: gen,
  });
  assert.equal(peekCompletionBootstrapCache("u1", "org1")?.freshness, "fresh");
  assert.equal(peekCompletionBootstrapCache("u2", "org1"), null);
  invalidateCompletionBootstrap(undefined, "org1");
  assert.equal(peekCompletionBootstrapCache("u1", "org1"), null);
});

test("containment allowlist for completion endpoints", () => {
  assert.equal(isAllowedInvoiceCompletionRead("GET", "/invoice-completion/bootstrap"), true);
  assert.equal(isAllowedInvoiceCompletionRead("GET", "/invoice-completion/list"), true);
});

test("Server-Timing unaccounted formula stays non-negative", () => {
  const unaccounted = computeCompletionUnaccountedMs({
    preRouteMs: 1,
    authMs: 2,
    tenantMs: 3,
    tenantDbMs: 3,
    orgMs: 0,
    queryMs: 10,
    countMs: 0,
    relationsMs: 5,
    mapMs: 1,
    serializeMs: 1,
    responseMs: 0,
    totalMs: 30,
    tenantDbRoundTrips: 0,
  });
  assert.ok(unaccounted >= 0);
  assert.ok(unaccounted < 50);
});
