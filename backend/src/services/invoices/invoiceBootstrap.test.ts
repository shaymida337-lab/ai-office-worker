import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prisma } from "../../lib/prisma.js";
import {
  assertInvoicesBootstrapPayloadBounds,
  getInvoicesBootstrap,
  INVOICES_BOOTSTRAP_FORBIDDEN_MARKERS,
  INVOICES_BOOTSTRAP_MAX_PAYLOAD_BYTES,
  INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT,
} from "./invoiceBootstrap.js";
import {
  getInvoicesBootstrapCacheGeneration,
  invalidateInvoicesBootstrap,
  peekInvoicesBootstrapCache,
  resetInvoicesBootstrapCacheForTests,
  setInvoicesBootstrapCache,
} from "./invoiceBootstrapCache.js";
import {
  assertInvoicesListPayloadBounds,
  buildInvoicesListPayload,
  clampInvoiceListPageSize,
  INVOICES_LIST_DEFAULT_PAGE_SIZE,
  INVOICES_LIST_FORBIDDEN_RESPONSE_KEYS,
  INVOICES_LIST_MAX_PAGE_SIZE,
  mapCandidateToListRow,
} from "./invoiceList.js";
import {
  buildInvoicesServerTiming,
  computeInvoicesUnaccountedMs,
  type InvoicesEndpointTiming,
} from "../../lib/invoicesEndpointTiming.js";
import { isAllowedInvoiceListRead } from "../p0/financialContainment.js";

const ORG = "org-invoices-bootstrap";
const ORG_B = "org-invoices-bootstrap-b";
const USER = "user-invoices-bootstrap";

function installMocks(options?: { approvedInvoices?: number; approvedPayments?: number }) {
  const seenOrgIds = new Set<string>();
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    invoiceCount: prisma.invoice.count.bind(prisma.invoice),
    paymentCount: prisma.supplierPayment.count.bind(prisma.supplierPayment),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    fdrFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    gsiCount: prisma.gmailScanItem.count.bind(prisma.gmailScanItem),
    clientFindMany: prisma.client.findMany.bind(prisma.client),
  };

  prisma.organization.findUnique = (async (args) => {
    const id = (args as { where?: { id?: string } }).where?.id;
    if (id) seenOrgIds.add(id);
    return {
      timezone: "Asia/Jerusalem",
      locale: "he-IL",
      currency: "ILS",
    };
  }) as typeof prisma.organization.findUnique;
  prisma.invoice.count = (async (args) => {
    const id = (args as { where?: { organizationId?: string } }).where?.organizationId;
    if (id) seenOrgIds.add(id);
    return options?.approvedInvoices ?? 10;
  }) as typeof prisma.invoice.count;
  prisma.supplierPayment.count = (async (args) => {
    const id = (args as { where?: { organizationId?: string } }).where?.organizationId;
    if (id) seenOrgIds.add(id);
    return options?.approvedPayments ?? 5;
  }) as typeof prisma.supplierPayment.count;
  prisma.financialDocumentReview.count = (async () => 3) as typeof prisma.financialDocumentReview.count;
  prisma.financialDocumentReview.findMany = (async () => []) as typeof prisma.financialDocumentReview.findMany;
  prisma.gmailScanItem.count = (async () => 2) as typeof prisma.gmailScanItem.count;
  prisma.client.findMany = (async (args) => {
    const take = (args as { take?: number }).take ?? 50;
    const where = (args as { where?: { organizationId?: string } }).where;
    if (where?.organizationId) seenOrgIds.add(where.organizationId);
    assert.ok(take <= INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT, "suppliers must be bounded");
    return [{ id: "c1", name: "Client A" }];
  }) as typeof prisma.client.findMany;

  return {
    seenOrgIds,
    restore() {
      prisma.organization.findUnique = originals.organizationFindUnique;
      prisma.invoice.count = originals.invoiceCount;
      prisma.supplierPayment.count = originals.paymentCount;
      prisma.financialDocumentReview.count = originals.fdrCount;
      prisma.financialDocumentReview.findMany = originals.fdrFindMany;
      prisma.gmailScanItem.count = originals.gsiCount;
      prisma.client.findMany = originals.clientFindMany;
      resetInvoicesBootstrapCacheForTests();
    },
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-15T10:00:00.000Z");
  return {
    id: "inv-1",
    clientId: "c1",
    invoiceNumber: "A-1",
    amount: 100,
    currency: "ILS",
    date: now,
    status: "approved",
    reviewStatus: "approved",
    source: "invoice" as const,
    reviewSourceId: null,
    driveUrl: null,
    driveFileUrl: null,
    client: { id: "c1", name: "Client", color: null },
    supplierName: "Client",
    documentType: "tax_invoice",
    isComplete: true,
    dataComplete: true,
    approvalRequired: false,
    createdAt: now,
    updatedAt: now,
    parsedFieldsJson: { secret: true, ocrText: "SECRET" },
    decisionReason: "nope",
    rawAnalysis: { huge: true },
    confidenceScore: 0.9,
    fromEmail: "a@b.com",
    gmailMessageId: "msg",
    ...overrides,
  };
}

test("invoices bootstrap payload bounds, no Google markers, suppliers capped, no fake zeros", async () => {
  const mocks = installMocks({ approvedInvoices: 10, approvedPayments: 5 });
  try {
    const payload = await getInvoicesBootstrap(ORG);
    assert.equal(payload.settings.timezone, "Asia/Jerusalem");
    assert.equal(payload.summary.approvedCount, 15);
    assert.ok(payload.summary.approvedCount > 0, "must not invent zero when counts exist");
    assert.ok(payload.summary.needsReviewCount >= 0);
    assert.ok(payload.summary.incompleteCount >= 0);
    assert.ok(payload.suppliersPreview.length <= INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT);
    assert.ok(!("invoices" in payload));
    assert.ok(Array.isArray(payload.filters.statuses));
    assertInvoicesBootstrapPayloadBounds(payload);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(bytes < INVOICES_BOOTSTRAP_MAX_PAYLOAD_BYTES);
    assert.ok(mocks.seenOrgIds.has(ORG));
    assert.ok(!mocks.seenOrgIds.has(ORG_B));
  } finally {
    mocks.restore();
  }

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, "invoiceBootstrap.ts"), "utf8");
  const importBlock = src.split("export const INVOICES_BOOTSTRAP_MAX_PAYLOAD_BYTES")[0] ?? src;
  for (const marker of INVOICES_BOOTSTRAP_FORBIDDEN_MARKERS) {
    assert.doesNotMatch(importBlock, new RegExp(marker));
  }
  const listSrc = fs.readFileSync(path.join(dir, "invoiceList.ts"), "utf8");
  for (const marker of INVOICES_BOOTSTRAP_FORBIDDEN_MARKERS) {
    assert.doesNotMatch(listSrc, new RegExp(marker));
  }
});

test("org isolation: bootstrap queries scoped to requested organizationId", async () => {
  const mocks = installMocks();
  try {
    await getInvoicesBootstrap(ORG);
    assert.deepEqual([...mocks.seenOrgIds], [ORG]);
    mocks.seenOrgIds.clear();
    await getInvoicesBootstrap(ORG_B);
    assert.deepEqual([...mocks.seenOrgIds], [ORG_B]);
  } finally {
    mocks.restore();
  }
});

test("invoices bootstrap cache isolation + generation bump", () => {
  resetInvoicesBootstrapCacheForTests();
  const mocks = installMocks();
  try {
    const payload = {
      settings: { timezone: "Asia/Jerusalem", locale: "he-IL", currency: "ILS" },
      filters: { statuses: ["all"], documentTypes: [], sourceTypes: [] },
      summary: { approvedCount: 1, needsReviewCount: 2, incompleteCount: 3 },
      suppliersPreview: [],
      generatedAt: new Date().toISOString(),
    };
    const gen = getInvoicesBootstrapCacheGeneration(USER, ORG);
    setInvoicesBootstrapCache({ userId: USER, organizationId: ORG, payload, generationAtStart: gen });
    assert.equal(peekInvoicesBootstrapCache(USER, ORG)?.freshness, "fresh");
    assert.equal(peekInvoicesBootstrapCache(USER, ORG_B), null);
    invalidateInvoicesBootstrap(undefined, ORG);
    assert.equal(peekInvoicesBootstrapCache(USER, ORG), null);
    setInvoicesBootstrapCache({ userId: USER, organizationId: ORG, payload, generationAtStart: gen });
    assert.equal(peekInvoicesBootstrapCache(USER, ORG), null);
  } finally {
    mocks.restore();
  }
});

test("invoices list pagination bounds + whitelist + no OCR/history fields + sort parity", () => {
  assert.equal(clampInvoiceListPageSize(1000), INVOICES_LIST_MAX_PAGE_SIZE);
  assert.equal(clampInvoiceListPageSize(undefined), INVOICES_LIST_DEFAULT_PAGE_SIZE);
  assert.equal(INVOICES_LIST_DEFAULT_PAGE_SIZE, 25);
  assert.equal(INVOICES_LIST_MAX_PAGE_SIZE, 100);

  const row = mapCandidateToListRow(candidate());
  assert.equal(row.invoiceNumber, "A-1");
  for (const key of INVOICES_LIST_FORBIDDEN_RESPONSE_KEYS) {
    assert.ok(!(key in row), `forbidden key leaked: ${key}`);
  }
  assert.ok(!("ocrText" in row));
  assert.ok(!("history" in row));
  assert.ok(!("notes" in row));
  assert.ok(!("attachmentBody" in row));

  const many = [
    candidate({ id: "a", amount: 10, date: new Date("2026-01-01T00:00:00.000Z") }),
    candidate({ id: "b", amount: 50, date: new Date("2026-06-01T00:00:00.000Z") }),
    candidate({
      id: "c",
      amount: 20,
      date: new Date("2026-03-01T00:00:00.000Z"),
      reviewStatus: "needs_review",
      status: "needs_review",
    }),
  ];
  const page1 = buildInvoicesListPayload(many, { page: 1, pageSize: 2, sort: "amount_desc" });
  assert.equal(page1.invoices.length, 2);
  assert.equal(page1.invoices[0]?.id, "b");
  assert.equal(page1.hasMore, true);
  assertInvoicesListPayloadBounds(page1);

  const approvedOnly = many.filter((c) => c.reviewStatus === "approved");
  const approvedPayload = buildInvoicesListPayload(approvedOnly, { page: 1, pageSize: 25 });
  assert.equal(approvedPayload.total, 2);
  assert.ok(approvedPayload.invoices.every((r) => r.reviewStatus === "approved"));
});

test("list map is pure (no N+1) and missing supplier stays null", () => {
  const row = mapCandidateToListRow(
    candidate({
      client: null,
      supplierName: null,
      clientId: "",
    })
  );
  assert.equal(row.supplierDisplayName, null);
  assert.equal(row.clientId, "");
});

test("invoices Server-Timing unaccounted <50ms and no PII", () => {
  const base: Omit<InvoicesEndpointTiming, "unaccountedMs"> = {
    preRouteMs: 0,
    authMs: 1,
    tenantMs: 1,
    tenantDbMs: 0,
    orgMs: 0,
    queryMs: 10,
    countMs: 2,
    relationsMs: 0,
    mapMs: 1,
    serializeMs: 1,
    responseMs: 0,
    totalMs: 16,
    tenantDbRoundTrips: 0,
  };
  const unaccounted = computeInvoicesUnaccountedMs(base);
  assert.ok(unaccounted < 50);
  const header = buildInvoicesServerTiming({ ...base, unaccountedMs: unaccounted });
  assert.match(header, /tenant_db;dur=0/);
  assert.doesNotMatch(header, /Bearer|token|@|supplier|invoiceNumber|amount/i);
});

test("containment allowlist includes bootstrap and list; verified tenant path has no membership lookup", () => {
  assert.equal(isAllowedInvoiceListRead("GET", "/invoices/bootstrap"), true);
  assert.equal(isAllowedInvoiceListRead("GET", "/invoices/list"), true);
  assert.equal(isAllowedInvoiceListRead("POST", "/invoices/bootstrap"), false);

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const containment = fs.readFileSync(path.join(dir, "../p0/financialContainment.ts"), "utf8");
  assert.match(containment, /\/invoices\/bootstrap/);
  assert.match(containment, /\/invoices\/list/);

  const bootstrapSrc = fs.readFileSync(path.join(dir, "invoiceBootstrap.ts"), "utf8");
  assert.doesNotMatch(bootstrapSrc, /organizationMembership|membership\.find/);

  const routesSnippet = fs.readFileSync(path.join(dir, "../../routes/api.ts"), "utf8");
  const bootstrapHandler = routesSnippet.slice(
    routesSnippet.indexOf('apiRouter.get("/invoices/bootstrap"'),
    routesSnippet.indexOf('apiRouter.get("/invoices/list"')
  );
  assert.match(bootstrapHandler, /getInvoicesBootstrapCachedForRequest/);
  assert.doesNotMatch(bootstrapHandler, /organizationMembership/);
  assert.match(bootstrapHandler, /invoicesFpTenantCacheSource|tenantCacheSource/);
});
