import test from "node:test";
import assert from "node:assert/strict";

import { GMAIL_SCAN_STALE_MS } from "../gmailScanLifecycle.js";
import {
  aggregateDecisionBuckets,
  aggregateExtractionMetrics,
  buildScannerHealthSummary,
  countScanErrors,
  emptyDecisionBucketCounts,
  fetchScannerHealthSummary,
  hasMissingAmountSignal,
  isFinancialDocumentType,
  isStuckGmailScan,
  isSupplierDetected,
  type ScannerHealthDb,
  type ScannerHealthGmailScanItemRow,
} from "./scannerHealthQueries.js";

const ORG_ID = "org-health-test";
const RANGE = {
  from: new Date("2026-07-01T00:00:00.000Z"),
  to: new Date("2026-07-01T23:59:59.999Z"),
};

function gsi(overrides: Partial<ScannerHealthGmailScanItemRow> = {}): ScannerHealthGmailScanItemRow {
  return {
    reviewStatus: "needs_review",
    documentType: "invoice",
    amount: null,
    supplierName: "Unknown supplier",
    decisionReason: "Held for review",
    parsedFieldsJson: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    ...overrides,
  };
}

test("empty org returns zeros and null rates", () => {
  const summary = buildScannerHealthSummary({
    organizationId: ORG_ID,
    range: RANGE,
    emailsIngested: 0,
    emailsProcessed: 0,
    gmailScanItemCount: 0,
    financialDocumentReviewCount: 0,
    gmailScanItems: [],
    syncLogsInRange: [],
    stuckScans: [],
  });

  assert.equal(summary.ingestion.emailsIngested, 0);
  assert.equal(summary.ingestion.emailsProcessed, 0);
  assert.equal(summary.ingestion.ingestionSuccessRate, null);
  assert.equal(summary.artifacts.gmailScanItemCount, 0);
  assert.equal(summary.artifacts.financialDocumentReviewCount, 0);
  assert.equal(summary.extraction.financialCandidateCount, 0);
  assert.equal(summary.extraction.amountExtractionRate, null);
  assert.equal(summary.extraction.supplierDetectionRate, null);
  assert.equal(summary.extraction.missingAmountCount, 0);
  assert.equal(summary.extraction.missingAmountRate, null);
  assert.deepEqual(summary.decisions, emptyDecisionBucketCounts());
  assert.equal(summary.scans.stuckScanCount, 0);
  assert.equal(summary.scans.scanErrorCount, 0);
});

test("aggregateDecisionBuckets counts mixed auto_save needs_review rejected blocked duplicate", () => {
  const counts = aggregateDecisionBuckets([
    gsi({ reviewStatus: "auto_saved" }),
    gsi({ reviewStatus: "needs_review" }),
    gsi({ reviewStatus: "rejected" }),
    gsi({
      reviewStatus: "needs_review",
      parsedFieldsJson: { outcome: { status: "BLOCKED", reasonCode: "OE_TRUST_BLOCKED" } },
    }),
    gsi({
      reviewStatus: "needs_review",
      parsedFieldsJson: { outcome: { status: "DUPLICATE", reasonCode: "OE_DUPLICATE" } },
    }),
    gsi({
      reviewStatus: "needs_review",
      decisionReason: "drive_link.unsupported: unreadable",
    }),
  ]);

  assert.equal(counts.auto_save, 1);
  assert.equal(counts.needs_review, 1);
  assert.equal(counts.rejected, 1);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.duplicate, 1);
  assert.equal(counts.unsupported, 1);
  assert.equal(counts.unknown, 0);
});

test("aggregateExtractionMetrics computes amount and supplier rates", () => {
  const metrics = aggregateExtractionMetrics([
    gsi({
      documentType: "invoice",
      amount: 1180,
      supplierName: "Acme Ltd",
      parsedFieldsJson: { reasons: [] },
    }),
    gsi({
      documentType: "invoice",
      amount: null,
      supplierName: "Unknown supplier",
      parsedFieldsJson: { reasons: ["amount_not_found"] },
    }),
    gsi({
      documentType: "invoice",
      amount: 40.01,
      supplierName: "Anthropic PBC",
    }),
    gsi({
      documentType: "unknown_needs_review",
      amount: null,
      supplierName: "Unknown supplier",
    }),
  ]);

  assert.equal(metrics.financialCandidateCount, 3);
  assert.equal(metrics.amountExtractedCount, 2);
  assert.equal(metrics.amountExtractionRate, 2 / 3);
  assert.equal(metrics.supplierDetectedCount, 2);
  assert.equal(metrics.supplierDetectionRate, 2 / 3);
  assert.equal(metrics.missingAmountCount, 1);
  assert.equal(metrics.missingAmountRate, 1 / 3);
});

test("hasMissingAmountSignal ignores non-financial document types", () => {
  assert.equal(
    hasMissingAmountSignal({
      amount: null,
      documentType: "unknown_needs_review",
      parsedFieldsJson: { reasons: ["amount_not_found"] },
    }),
    false,
  );
  assert.equal(isFinancialDocumentType("tax_invoice_receipt"), true);
  assert.equal(isSupplierDetected("Acme Ltd"), true);
  assert.equal(isSupplierDetected("Unknown supplier"), false);
});

test("isStuckGmailScan detects active scans older than stale threshold", () => {
  const now = new Date("2026-07-01T13:00:00.000Z");
  const staleStartedAt = new Date(now.getTime() - GMAIL_SCAN_STALE_MS - 1_000);
  const freshStartedAt = new Date(now.getTime() - 5 * 60 * 1000);

  assert.equal(
    isStuckGmailScan({ status: "running", startedAt: staleStartedAt }, now),
    true,
  );
  assert.equal(
    isStuckGmailScan({ status: "running", startedAt: freshStartedAt }, now),
    false,
  );
  assert.equal(
    isStuckGmailScan({ status: "completed", startedAt: staleStartedAt }, now),
    false,
  );
});

test("countScanErrors sums errorsCount from sync logs in range", () => {
  assert.equal(
    countScanErrors([
      { status: "partial", errorsCount: 2, startedAt: RANGE.from },
      { status: "success", errorsCount: 0, startedAt: RANGE.from },
      { status: "error", errorsCount: 1, startedAt: RANGE.from },
    ]),
    3,
  );
});

test("buildScannerHealthSummary computes ingestion success rate", () => {
  const summary = buildScannerHealthSummary({
    organizationId: ORG_ID,
    range: RANGE,
    emailsIngested: 10,
    emailsProcessed: 8,
    gmailScanItemCount: 5,
    financialDocumentReviewCount: 4,
    gmailScanItems: [gsi({ reviewStatus: "auto_saved", amount: 100, supplierName: "Acme Ltd" })],
    syncLogsInRange: [{ status: "success", errorsCount: 0, startedAt: RANGE.from }],
    stuckScans: [{ status: "running", errorsCount: 0, startedAt: new Date("2026-06-01T00:00:00.000Z") }],
  });

  assert.equal(summary.ingestion.ingestionSuccessRate, 0.8);
  assert.equal(summary.artifacts.gmailScanItemCount, 5);
  assert.equal(summary.artifacts.financialDocumentReviewCount, 4);
  assert.equal(summary.scans.stuckScanCount, 1);
  assert.equal(summary.scans.scanErrorCount, 0);
});

test("fetchScannerHealthSummary applies date range filters via mocked Prisma", async () => {
  const gsiRows = [
    gsi({
      reviewStatus: "auto_saved",
      amount: 500,
      supplierName: "Kedma",
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
    }),
  ];

  const emailWhere: unknown[] = [];
  const gsiWhere: unknown[] = [];
  const fdrWhere: unknown[] = [];
  const syncWhere: unknown[] = [];
  const stuckWhere: unknown[] = [];

  let emailCountCalls = 0;
  const db: ScannerHealthDb = {
    emailMessage: {
      count: async ({ where }) => {
        emailWhere.push(where);
        emailCountCalls += 1;
        return emailCountCalls === 1 ? 3 : 2;
      },
    },
    gmailScanItem: {
      count: async ({ where }) => {
        gsiWhere.push(where);
        return 1;
      },
      findMany: async ({ where }) => {
        gsiWhere.push(where);
        return gsiRows;
      },
    },
    financialDocumentReview: {
      count: async ({ where }) => {
        fdrWhere.push(where);
        return 1;
      },
    },
    syncLog: {
      findMany: async ({ where }) => {
        if (
          where &&
          typeof where === "object" &&
          "status" in where &&
          where.status &&
          typeof where.status === "object" &&
          where.status !== null &&
          "in" in where.status
        ) {
          stuckWhere.push(where);
          return [{ status: "queued", errorsCount: 0, startedAt: new Date("2026-06-01T00:00:00.000Z") }];
        }
        syncWhere.push(where);
        return [{ status: "partial", errorsCount: 2, startedAt: RANGE.from }];
      },
    },
  };

  const now = new Date("2026-07-01T15:00:00.000Z");
  const summary = await fetchScannerHealthSummary(db, {
    organizationId: ORG_ID,
    range: RANGE,
    now,
  });

  assert.equal(summary.ingestion.emailsIngested, 3);
  assert.equal(summary.ingestion.emailsProcessed, 2);
  assert.equal(summary.artifacts.gmailScanItemCount, 1);
  assert.equal(summary.decisions.auto_save, 1);
  assert.equal(summary.scans.scanErrorCount, 2);
  assert.equal(summary.scans.stuckScanCount, 1);

  const ingestedFilter = emailWhere[0] as {
    organizationId: string;
    receivedAt: { gte: Date; lte: Date };
  };
  assert.equal(ingestedFilter.organizationId, ORG_ID);
  assert.equal(ingestedFilter.receivedAt.gte.toISOString(), RANGE.from.toISOString());
  assert.equal(ingestedFilter.receivedAt.lte.toISOString(), RANGE.to.toISOString());

  const gsiFilter = gsiWhere[0] as {
    organizationId: string;
    createdAt: { gte: Date; lte: Date };
  };
  assert.equal(gsiFilter.createdAt.gte.toISOString(), RANGE.from.toISOString());

  const fdrFilter = fdrWhere[0] as {
    organizationId: string;
    createdAt: { gte: Date; lte: Date };
  };
  assert.equal(fdrFilter.organizationId, ORG_ID);

  const syncFilter = syncWhere[0] as {
    organizationId: string;
    type: string;
    startedAt: { gte: Date; lte: Date };
  };
  assert.equal(syncFilter.type, "gmail_scan");

  const stuckFilter = stuckWhere[0] as {
    organizationId: string;
    type: string;
    status: { in: string[] };
    startedAt: { lte: Date };
  };
  assert.equal(stuckFilter.type, "gmail_scan");
  assert.ok(stuckFilter.status.in.includes("running"));
  assert.equal(
    stuckFilter.startedAt.lte.toISOString(),
    new Date(now.getTime() - GMAIL_SCAN_STALE_MS).toISOString(),
  );
});
