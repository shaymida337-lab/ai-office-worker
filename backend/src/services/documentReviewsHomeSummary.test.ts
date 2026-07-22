import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT,
  DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT,
  assertDocumentReviewHomeSummaryShape,
  buildDocumentReviewsListWhere,
  getDocumentReviewsHomeSummary,
  mapDocumentReviewHomeSummaryItem,
} from "./documentReviewsHomeSummary.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  mergePrismaWhere,
  resetCrossOrgContaminatedGmailIdsCacheForTests,
} from "./p0/financialReadIsolation.js";

const ORG_A = "org-summary-a";
const ORG_B = "org-summary-b";

function makeRow(
  overrides: Partial<{
    id: string;
    supplierName: string | null;
    sender: string | null;
    totalAmount: number | null;
    currency: string;
    documentDate: Date | null;
    createdAt: Date;
    reviewStatus: string;
    uncertaintyReason: string | null;
    documentType: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "rev-1",
    supplierName: overrides.supplierName ?? "ספק",
    sender: overrides.sender ?? null,
    totalAmount: overrides.totalAmount ?? 100,
    currency: overrides.currency ?? "ILS",
    documentDate: overrides.documentDate ?? new Date("2026-07-01T00:00:00.000Z"),
    createdAt: overrides.createdAt ?? new Date("2026-07-20T12:00:00.000Z"),
    reviewStatus: overrides.reviewStatus ?? "needs_review",
    uncertaintyReason: overrides.uncertaintyReason ?? null,
    documentType: overrides.documentType ?? "invoice",
  };
}

test("field whitelist: mapped summary item only exposes home fields", () => {
  const mapped = mapDocumentReviewHomeSummaryItem(makeRow());
  assert.deepEqual(Object.keys(mapped).sort(), Object.keys(DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT).sort());
  assert.equal(mapped.id, "rev-1");
  assert.equal(mapped.supplierName, "ספק");
  assert.equal(mapped.totalAmount, 100);
  assert.equal(mapped.documentDate, "2026-07-01T00:00:00.000Z");
  assert.equal(mapped.createdAt, "2026-07-20T12:00:00.000Z");
  assert.equal(mapped.reviewStatus, "needs_review");
  assertDocumentReviewHomeSummaryShape({ count: 1, items: [mapped] });
});

test("limit=5: assertDocumentReviewHomeSummaryShape rejects >5 items", () => {
  const items = Array.from({ length: 6 }, (_, i) =>
    mapDocumentReviewHomeSummaryItem(makeRow({ id: `rev-${i}` })),
  );
  assert.throws(() => assertDocumentReviewHomeSummaryShape({ count: 6, items }), /<= 5/);
});

test("org isolation: where always scopes organizationId and status", () => {
  const contaminated = ["gmail-x"];
  const whereA = buildDocumentReviewsListWhere(ORG_A, "needs_review", contaminated);
  const whereB = buildDocumentReviewsListWhere(ORG_B, "needs_review", contaminated);
  assert.equal((whereA as { organizationId?: string }).organizationId, ORG_A);
  assert.equal((whereB as { organizationId?: string }).organizationId, ORG_B);
  assert.equal((whereA as { reviewStatus?: string }).reviewStatus, "needs_review");
  assert.notDeepEqual(whereA, whereB);

  const expected = mergePrismaWhere(
    { organizationId: ORG_A, reviewStatus: "needs_review" },
    buildFinancialDocumentReviewReadIsolationWhere(ORG_A, contaminated),
  );
  assert.deepEqual(whereA, expected);
});

test("count + sort + limit parity: summary uses same where/order as full list policy", async () => {
  const originals = {
    count: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    findMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
  };

  const rows = Array.from({ length: 8 }, (_, i) =>
    makeRow({
      id: `rev-${i}`,
      createdAt: new Date(Date.UTC(2026, 6, 22, 12, i)),
      supplierName: `S${i}`,
    }),
  );
  const ordered = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  let capturedWhere: unknown;
  let findManyArgs: { take?: number; orderBy?: unknown; select?: unknown } | null = null;

  prisma.financialDocumentReview.count = (async (args: { where?: unknown }) => {
    capturedWhere = args?.where;
    return 42;
  }) as typeof prisma.financialDocumentReview.count;

  prisma.financialDocumentReview.findMany = (async (args: {
    where?: unknown;
    take?: number;
    orderBy?: unknown;
    select?: unknown;
  }) => {
    findManyArgs = args;
    assert.deepEqual(args.where, capturedWhere);
    return ordered.slice(0, args.take ?? DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT);
  }) as typeof prisma.financialDocumentReview.findMany;

  try {
    const where = buildDocumentReviewsListWhere(ORG_A, "needs_review", []);
    const [count, found] = await Promise.all([
      prisma.financialDocumentReview.count({ where }),
      prisma.financialDocumentReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: DOCUMENT_REVIEWS_HOME_SUMMARY_LIMIT,
        select: DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT,
      }),
    ]);
    assert.equal(count, 42);
    assert.equal(findManyArgs?.take, 5);
    assert.deepEqual(findManyArgs?.orderBy, { createdAt: "desc" });
    assert.deepEqual(findManyArgs?.select, DOCUMENT_REVIEWS_HOME_SUMMARY_SELECT);
    assert.equal(found.length, 5);
    assert.deepEqual(
      found.map((r) => r.id),
      ordered.slice(0, 5).map((r) => r.id),
    );
    const payload = { count, items: found.map(mapDocumentReviewHomeSummaryItem) };
    assertDocumentReviewHomeSummaryShape(payload);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(bytes < 50_000, `summary payload ${bytes}B must be < 50KB`);
  } finally {
    prisma.financialDocumentReview.count = originals.count;
    prisma.financialDocumentReview.findMany = originals.findMany;
  }
});

test("getDocumentReviewsHomeSummary returns count + ≤5 items without forbidden fields", async () => {
  resetCrossOrgContaminatedGmailIdsCacheForTests();
  const originals = {
    count: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    findMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
  };

  const ordered = Array.from({ length: 7 }, (_, i) =>
    makeRow({
      id: `id-${i}`,
      createdAt: new Date(Date.UTC(2026, 6, 22, 10, i)),
      supplierName: `Supplier ${i}`,
    }),
  ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  prisma.$queryRawUnsafe = (async () => []) as typeof prisma.$queryRawUnsafe;
  prisma.financialDocumentReview.count = (async () => 7) as typeof prisma.financialDocumentReview.count;
  prisma.financialDocumentReview.findMany = (async (args: { take?: number }) =>
    ordered.slice(0, args?.take ?? 5)) as typeof prisma.financialDocumentReview.findMany;

  try {
    const payload = await getDocumentReviewsHomeSummary({
      organizationId: ORG_A,
      status: "needs_review",
    });
    assert.equal(payload.count, 7);
    assert.equal(payload.items.length, 5);
    assert.deepEqual(
      payload.items.map((i) => i.id),
      ordered.slice(0, 5).map((r) => r.id),
    );
    for (const item of payload.items) {
      assert.equal("decision" in item, false);
      assert.equal("rawAnalysis" in item, false);
      assert.equal("parsedFieldsJson" in item, false);
      assert.equal("driveFileUrl" in item, false);
      assert.equal("canApprove" in item, false);
    }
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(bytes < 50_000);
  } finally {
    prisma.financialDocumentReview.count = originals.count;
    prisma.financialDocumentReview.findMany = originals.findMany;
    prisma.$queryRawUnsafe = originals.queryRaw;
    resetCrossOrgContaminatedGmailIdsCacheForTests();
  }
});

test("full document-reviews route path remains enrichment + take 200 when view!=summary", async () => {
  const source = await readFile(new URL("../routes/api.ts", import.meta.url), "utf8");
  const handlerStart = source.indexOf('apiRouter.get("/document-reviews"');
  assert.ok(handlerStart >= 0);
  const nextRoute = source.indexOf('apiRouter.get("/document-reviews/:id/decision"', handlerStart + 1);
  const block = source.slice(handlerStart, nextRoute > 0 ? nextRoute : handlerStart + 2500);
  assert.match(block, /view === "summary"/);
  assert.match(block, /getDocumentReviewsHomeSummary/);
  assert.match(block, /take:\s*200/);
  assert.match(block, /buildReviewDecision/);
  assert.match(block, /mapDocumentReviewForApi/);
  assert.match(block, /res\.json\(mapped\)/);
});
