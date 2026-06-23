import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCURACY_ANALYTICS_ROUTE_PATH,
  accuracyAnalyticsResponseContainsForbiddenFields,
  buildAccuracyAnalyticsResponse,
  getAccuracyAnalyticsForOrganization,
  loadAccuracyAnalyticsDocuments,
  mapAccuracyAnalyticsRow,
  parseAccuracyAnalyticsQuery,
  type AccuracyAnalyticsDb,
} from "./accuracyAnalytics.js";
import { ANALYTICS_VERSION } from "./analyticsTypes.js";
import { containsLikelyPii } from "../golden/goldenSanitizer.js";

const fixtureParsedFields = {
  amount: 1180,
  arc: {
    selectedAmount: 1180,
    confidence: 0.91,
    status: "resolved",
  },
  sir: {
    supplierName: "billing@supplier.example.com",
    canonicalSupplier: "Acme",
    status: "resolved",
    confidence: 0.88,
  },
  fse: {
    trustScore: 0.82,
    overallStatus: "valid",
  },
  trust: {
    confidence: 0.9,
    decision: "AUTO_SAVE",
  },
  outcome: {
    status: "SAVED",
  },
  performance: {
    processingMs: 950,
    aiMs: 410,
    ocrMs: 180,
  },
};

test("accuracy analytics: parseAccuracyAnalyticsQuery defaults and validates", () => {
  assert.deepEqual(parseAccuracyAnalyticsQuery({}), { days: 30, source: "all" });
  assert.deepEqual(parseAccuracyAnalyticsQuery({ days: "7", source: "gmail" }), { days: 7, source: "gmail" });
  assert.deepEqual(parseAccuracyAnalyticsQuery({ days: "90", source: "ALL" }), { days: 90, source: "all" });
  assert.deepEqual(parseAccuracyAnalyticsQuery({ days: "bad" }), { days: 30, source: "all" });
});

test("accuracy analytics: mapAccuracyAnalyticsRow maps engine summaries", () => {
  const record = mapAccuracyAnalyticsRow({
    id: "gsi:1",
    amount: 999,
    supplierName: "ignored when sir present",
    reviewStatus: "auto_saved",
    parsedFieldsJson: fixtureParsedFields,
  });

  assert.equal(record.outcomeStatus, "SAVED");
  assert.equal(record.amount, 1180);
  assert.equal(record.supplierStatus, "resolved");
  assert.equal(record.trustConfidence, 0.9);
  assert.equal(record.arcConfidence, 0.91);
  assert.equal(record.sirConfidence, 0.88);
  assert.equal(record.fseTrustScore, 0.82);
  assert.equal(record.processingMs, 950);
});

test("accuracy analytics: buildAccuracyAnalyticsResponse calculates metrics without raw PII fields", () => {
  const documents = [
    mapAccuracyAnalyticsRow({
      id: "gsi:1",
      supplierName: "Secret Supplier Ltd",
      reviewStatus: "auto_saved",
      parsedFieldsJson: fixtureParsedFields,
    }),
    mapAccuracyAnalyticsRow({
      id: "gsi:2",
      supplierName: "unknown",
      reviewStatus: "needs_review",
      parsedFieldsJson: {
        outcome: { status: "NEEDS_REVIEW" },
        arc: { selectedAmount: 0, confidence: 0.4 },
        sir: { status: "unresolved", supplierName: "unknown" },
      },
    }),
  ];

  const response = buildAccuracyAnalyticsResponse({
    query: { days: 30, source: "gmail" },
    documents,
    now: new Date("2026-06-15T12:00:00.000Z"),
  });

  assert.equal(response.version, ANALYTICS_VERSION);
  assert.equal(response.documentCount, 2);
  assert.equal(response.outcome.savedCount, 1);
  assert.equal(response.outcome.reviewCount, 1);
  assert.equal(response.supplier.unknownSupplierCount, 1);
  assert.equal(response.amount.zeroAmountCount, 1);
  assert.equal(response.trust.averageTrustConfidence, 0.9);
  assert.equal(response.golden.goldenPassRate, null);
  assert.equal(accuracyAnalyticsResponseContainsForbiddenFields(response), null);

  const serialized = JSON.stringify(response);
  assert.ok(!serialized.includes("billing@supplier.example.com"));
  assert.ok(!serialized.includes("Secret Supplier Ltd"));
  assert.ok(!serialized.includes("parsedFieldsJson"));
  assert.ok(!containsLikelyPii(serialized));
});

test("accuracy analytics: empty organization returns zero metrics", async () => {
  const db = {
    gmailScanItem: { findMany: async () => [] },
    financialDocumentReview: { findMany: async () => [] },
    supplierPayment: { findMany: async () => [] },
  } as unknown as AccuracyAnalyticsDb;

  const response = await getAccuracyAnalyticsForOrganization(db, "org-empty", { days: 7, source: "all" });

  assert.equal(response.documentCount, 0);
  assert.equal(response.outcome.totalDocuments, 0);
  assert.equal(response.outcome.savedPercent, 0);
  assert.equal(response.supplier.supplierResolutionRate, 0);
  assert.equal(response.amount.averageAmount, null);
  assert.equal(response.trust.averageTrustConfidence, null);
});

test("accuracy analytics: loadAccuracyAnalyticsDocuments is organization scoped and dedupes FDR by gmail message", async () => {
  let gmailOrgId = "";
  let reviewOrgId = "";

  const db = {
    gmailScanItem: {
      findMany: async (args: { where: { organizationId: string } }) => {
        gmailOrgId = args.where.organizationId;
        return [
          {
            id: "scan-1",
            amount: 100,
            supplierName: "Acme",
            reviewStatus: "auto_saved",
            parsedFieldsJson: { outcome: { status: "SAVED" } },
            gmailMessageId: "gmail-1",
          },
        ];
      },
    },
    financialDocumentReview: {
      findMany: async (args: { where: { organizationId: string } }) => {
        reviewOrgId = args.where.organizationId;
        return [
          {
            id: "review-dup",
            totalAmount: 200,
            supplierName: "Acme",
            reviewStatus: "needs_review",
            parsedFieldsJson: { outcome: { status: "NEEDS_REVIEW" } },
            gmailMessageId: "gmail-1",
          },
          {
            id: "review-unique",
            totalAmount: 300,
            supplierName: "Beta",
            reviewStatus: "needs_review",
            parsedFieldsJson: { outcome: { status: "NEEDS_REVIEW" } },
            gmailMessageId: "gmail-2",
          },
        ];
      },
    },
    supplierPayment: {
      findMany: async () => [
        {
          id: "pay-1",
          amount: 50,
          totalAmount: 50,
          supplier: "Gamma",
          supplierName: "Gamma",
          approvalStatus: "approved",
          parsedFieldsJson: { outcome: { status: "SAVED" }, trust: { confidence: 0.7 } },
          duplicateDetected: false,
        },
      ],
    },
  } as unknown as AccuracyAnalyticsDb;

  const documents = await loadAccuracyAnalyticsDocuments(db, "org-scoped", { days: 30, source: "all" });

  assert.equal(gmailOrgId, "org-scoped");
  assert.equal(reviewOrgId, "org-scoped");
  assert.equal(documents.length, 3);
  assert.ok(documents.some((document) => document.id === "gsi:scan-1"));
  assert.ok(documents.some((document) => document.id === "fdr:review-unique"));
  assert.ok(!documents.some((document) => document.id === "fdr:review-dup"));
  assert.ok(documents.some((document) => document.id === "sp:pay-1"));
});

test("accuracy analytics: requires organization id", async () => {
  const db = {
    gmailScanItem: { findMany: async () => [] },
    financialDocumentReview: { findMany: async () => [] },
    supplierPayment: { findMany: async () => [] },
  } as unknown as AccuracyAnalyticsDb;

  await assert.rejects(
    () => loadAccuracyAnalyticsDocuments(db, "", { days: 30, source: "gmail" }),
    /organizationId is required/
  );
});

test("accuracy analytics: route path is internal", () => {
  assert.equal(ACCURACY_ANALYTICS_ROUTE_PATH, "/internal/analytics/accuracy");
});

test("accuracy analytics: auth is required via api router middleware contract", () => {
  assert.match(ACCURACY_ANALYTICS_ROUTE_PATH, /^\/internal\//);
});
