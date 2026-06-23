import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAmountMetrics,
  computeAnalyticsSummary,
  computeOutcomeMetrics,
  computePerformanceMetrics,
  computeSupplierMetrics,
  computeTrustMetrics,
  isSuspiciousAmount,
  isUnknownSupplier,
} from "./analyticsAggregator.js";
import type { AnalyticsDocumentRecord } from "./analyticsTypes.js";
import { ANALYTICS_VERSION } from "./analyticsTypes.js";
import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";

type SyntheticSpec = {
  outcomeStatus: DocumentOutcomeStatus;
  supplierName?: string | null;
  supplierStatus?: string | null;
  amount?: number | null;
  suspiciousAmount?: boolean;
  trustConfidence?: number | null;
  arcConfidence?: number | null;
  sirConfidence?: number | null;
  fseTrustScore?: number | null;
  processingMs?: number | null;
  aiMs?: number | null;
  ocrMs?: number | null;
};

function buildSyntheticDocuments(specs: SyntheticSpec[]): AnalyticsDocumentRecord[] {
  return specs.map((spec, index) => ({
    id: `doc-${String(index + 1).padStart(3, "0")}`,
    ...spec,
  }));
}

function repeat<T>(value: T, count: number): T[] {
  return Array.from({ length: count }, () => value);
}

function buildMixedHundredDocuments(): AnalyticsDocumentRecord[] {
  const outcomeSpecs: SyntheticSpec[] = [
    ...repeat({ outcomeStatus: "SAVED" as const, supplierStatus: "resolved", supplierName: "Acme" }, 40),
    ...repeat({ outcomeStatus: "NEEDS_REVIEW" as const, supplierStatus: "resolved", supplierName: "Beta" }, 25),
    ...repeat({ outcomeStatus: "BLOCKED" as const, supplierStatus: "resolved", supplierName: "Gamma" }, 10),
    ...repeat({ outcomeStatus: "DUPLICATE" as const, supplierStatus: "resolved", supplierName: "Delta" }, 5),
    ...repeat({ outcomeStatus: "ERROR" as const, supplierStatus: "resolved", supplierName: "Epsilon" }, 5),
    ...repeat({ outcomeStatus: "NOT_FINANCIAL" as const, supplierStatus: "unresolved", supplierName: "unknown" }, 15),
  ];

  const docs = buildSyntheticDocuments(outcomeSpecs);

  for (let index = 0; index < docs.length; index++) {
    const document = docs[index];
    document.amount = 100 + index * 10;
    document.trustConfidence = 0.55 + (index % 45) / 100;
    document.arcConfidence = 0.6 + (index % 35) / 100;
    document.sirConfidence = 0.5 + (index % 40) / 100;
    document.fseTrustScore = 0.65 + (index % 30) / 100;
    document.processingMs = 800 + (index % 20) * 25;
    document.aiMs = 300 + (index % 15) * 20;
    document.ocrMs = 120 + (index % 10) * 15;
  }

  for (let index = 0; index < 8; index++) {
    docs[index].amount = 0;
  }

  docs[10].amount = 150_000;
  docs[11].amount = 250_000;
  docs[12].suspiciousAmount = true;
  docs[12].amount = 12_000;

  for (let index = 80; index < 100; index++) {
    docs[index].supplierName = index % 2 === 0 ? "." : "unknown";
    docs[index].supplierStatus = "unresolved";
  }

  return docs;
}

test("analytics: computeOutcomeMetrics counts and percentages for mixed outcomes", () => {
  const documents = buildMixedHundredDocuments();
  const outcome = computeOutcomeMetrics(documents);

  assert.equal(outcome.totalDocuments, 100);
  assert.equal(outcome.savedCount, 40);
  assert.equal(outcome.reviewCount, 25);
  assert.equal(outcome.blockedCount, 10);
  assert.equal(outcome.duplicateCount, 5);
  assert.equal(outcome.errorCount, 5);
  assert.equal(outcome.notFinancialCount, 15);
  assert.equal(outcome.savedPercent, 40);
  assert.equal(outcome.reviewPercent, 25);
  assert.equal(outcome.blockedPercent, 10);
  assert.equal(outcome.duplicatePercent, 5);
  assert.equal(outcome.errorPercent, 5);
  assert.equal(outcome.notFinancialPercent, 15);
});

test("analytics: computeSupplierMetrics tracks unknown and resolved suppliers", () => {
  const documents = buildMixedHundredDocuments();
  const supplier = computeSupplierMetrics(documents);

  assert.equal(supplier.unknownSupplierCount, 20);
  assert.equal(supplier.supplierResolvedCount, 80);
  assert.equal(supplier.supplierResolutionRate, 80);
  assert.equal(supplier.unknownSupplierPercent, 20);
});

test("analytics: computeAmountMetrics tracks zero, suspicious, and average amount", () => {
  const documents = buildMixedHundredDocuments();
  const amount = computeAmountMetrics(documents);

  assert.equal(amount.zeroAmountCount, 8);
  assert.equal(amount.suspiciousAmountCount, 3);
  assert.equal(amount.zeroAmountPercent, 8);
  assert.equal(amount.suspiciousAmountPercent, 3);
  assert.ok(amount.averageAmount != null);
  assert.ok(amount.averageAmount! > 0);
});

test("analytics: computeTrustMetrics averages confidence scores", () => {
  const documents = buildMixedHundredDocuments();
  const trust = computeTrustMetrics(documents);

  assert.equal(trust.averageTrustConfidence, 0.75);
  assert.equal(trust.averageArcConfidence, 0.76);
  assert.equal(trust.averageSirConfidence, 0.68);
  assert.equal(trust.averageFseTrust, 0.79);
});

test("analytics: computePerformanceMetrics averages timing fields", () => {
  const documents = buildMixedHundredDocuments();
  const performance = computePerformanceMetrics(documents);

  assert.equal(performance.averageProcessingMs, 1037.5);
  assert.equal(performance.averageAiMs, 435);
  assert.equal(performance.averageOcrMs, 187.5);
});

test("analytics: computeAnalyticsSummary returns analytics-v1 with golden rates", () => {
  const documents = buildMixedHundredDocuments();
  const summary = computeAnalyticsSummary(documents, { total: 20, passed: 17, failed: 3 });

  assert.equal(summary.version, ANALYTICS_VERSION);
  assert.equal(summary.documentCount, 100);
  assert.equal(summary.outcome.savedCount, 40);
  assert.equal(summary.supplier.supplierResolutionRate, 80);
  assert.equal(summary.amount.zeroAmountCount, 8);
  assert.equal(summary.trust.averageFseTrust, 0.79);
  assert.equal(summary.performance.averageAiMs, 435);
  assert.equal(summary.golden.goldenPassRate, 85);
  assert.equal(summary.golden.goldenFailRate, 15);
});

test("analytics: helper predicates classify supplier and suspicious amount", () => {
  assert.equal(isUnknownSupplier({ id: "a", outcomeStatus: "SAVED", supplierName: "unknown" }), true);
  assert.equal(isUnknownSupplier({ id: "b", outcomeStatus: "SAVED", supplierStatus: "resolved", supplierName: "Acme" }), false);
  assert.equal(
    isSuspiciousAmount({ id: "c", outcomeStatus: "SAVED", amount: 50_000, suspiciousAmount: true }),
    true
  );
  assert.equal(isSuspiciousAmount({ id: "d", outcomeStatus: "SAVED", amount: 200_000 }), true);
  assert.equal(isSuspiciousAmount({ id: "e", outcomeStatus: "SAVED", amount: 500 }), false);
});

test("analytics: empty input returns zeroed metrics and null golden rates", () => {
  const summary = computeAnalyticsSummary([]);

  assert.equal(summary.documentCount, 0);
  assert.equal(summary.outcome.totalDocuments, 0);
  assert.equal(summary.outcome.savedPercent, 0);
  assert.equal(summary.supplier.supplierResolutionRate, 0);
  assert.equal(summary.amount.averageAmount, null);
  assert.equal(summary.trust.averageTrustConfidence, null);
  assert.equal(summary.performance.averageProcessingMs, null);
  assert.equal(summary.golden.goldenPassRate, null);
  assert.equal(summary.golden.goldenFailRate, null);
});
