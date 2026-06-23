import type {
  AnalyticsDocumentRecord,
  AnalyticsSummary,
  AmountMetrics,
  GoldenAnalyticsInput,
  GoldenMetrics,
  OutcomeMetrics,
  PerformanceMetrics,
  SupplierMetrics,
  TrustMetrics,
} from "./analyticsTypes.js";
import { ANALYTICS_VERSION, SUSPICIOUS_AMOUNT_THRESHOLD } from "./analyticsTypes.js";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(count: number, total: number): number {
  if (total <= 0) return 0;
  return round((count / total) * 100);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countOutcome(documents: AnalyticsDocumentRecord[], status: AnalyticsDocumentRecord["outcomeStatus"]) {
  return documents.filter((document) => document.outcomeStatus === status).length;
}

export function isUnknownSupplier(record: AnalyticsDocumentRecord): boolean {
  if (record.supplierStatus === "resolved") return false;
  if (record.supplierStatus && record.supplierStatus !== "resolved") {
    return record.supplierStatus === "unresolved" || record.supplierStatus === "unknown";
  }
  const name = record.supplierName?.trim().toLowerCase() ?? "";
  return !name || name === "." || name === "unknown";
}

export function isSupplierResolved(record: AnalyticsDocumentRecord): boolean {
  if (record.supplierStatus === "resolved") return true;
  if (record.supplierStatus && record.supplierStatus !== "resolved") return false;
  return !isUnknownSupplier(record);
}

export function isZeroAmount(amount: number | null | undefined): boolean {
  return amount == null || amount === 0;
}

export function isSuspiciousAmount(record: AnalyticsDocumentRecord): boolean {
  if (record.suspiciousAmount === true) return true;
  const amount = record.amount;
  if (amount == null) return false;
  return amount > SUSPICIOUS_AMOUNT_THRESHOLD;
}

export function computeOutcomeMetrics(documents: AnalyticsDocumentRecord[]): OutcomeMetrics {
  const totalDocuments = documents.length;
  const savedCount = countOutcome(documents, "SAVED");
  const reviewCount = countOutcome(documents, "NEEDS_REVIEW");
  const blockedCount = countOutcome(documents, "BLOCKED");
  const duplicateCount = countOutcome(documents, "DUPLICATE");
  const errorCount = countOutcome(documents, "ERROR");
  const notFinancialCount = countOutcome(documents, "NOT_FINANCIAL");

  return {
    totalDocuments,
    savedCount,
    reviewCount,
    blockedCount,
    duplicateCount,
    errorCount,
    notFinancialCount,
    savedPercent: percent(savedCount, totalDocuments),
    reviewPercent: percent(reviewCount, totalDocuments),
    blockedPercent: percent(blockedCount, totalDocuments),
    duplicatePercent: percent(duplicateCount, totalDocuments),
    errorPercent: percent(errorCount, totalDocuments),
    notFinancialPercent: percent(notFinancialCount, totalDocuments),
  };
}

export function computeSupplierMetrics(documents: AnalyticsDocumentRecord[]): SupplierMetrics {
  const totalDocuments = documents.length;
  const unknownSupplierCount = documents.filter((document) => isUnknownSupplier(document)).length;
  const supplierResolvedCount = documents.filter((document) => isSupplierResolved(document)).length;

  return {
    unknownSupplierCount,
    supplierResolvedCount,
    supplierResolutionRate: percent(supplierResolvedCount, totalDocuments),
    unknownSupplierPercent: percent(unknownSupplierCount, totalDocuments),
  };
}

export function computeAmountMetrics(documents: AnalyticsDocumentRecord[]): AmountMetrics {
  const totalDocuments = documents.length;
  const zeroAmountCount = documents.filter((document) => isZeroAmount(document.amount)).length;
  const suspiciousAmountCount = documents.filter((document) => isSuspiciousAmount(document)).length;
  const amountValues = documents
    .map((document) => document.amount)
    .filter((amount): amount is number => amount != null && Number.isFinite(amount));

  return {
    zeroAmountCount,
    suspiciousAmountCount,
    averageAmount: average(amountValues),
    zeroAmountPercent: percent(zeroAmountCount, totalDocuments),
    suspiciousAmountPercent: percent(suspiciousAmountCount, totalDocuments),
  };
}

export function computeTrustMetrics(documents: AnalyticsDocumentRecord[]): TrustMetrics {
  const trustValues = documents
    .map((document) => document.trustConfidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const arcValues = documents
    .map((document) => document.arcConfidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const sirValues = documents
    .map((document) => document.sirConfidence)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const fseValues = documents
    .map((document) => document.fseTrustScore)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    averageTrustConfidence: average(trustValues),
    averageArcConfidence: average(arcValues),
    averageSirConfidence: average(sirValues),
    averageFseTrust: average(fseValues),
  };
}

export function computePerformanceMetrics(documents: AnalyticsDocumentRecord[]): PerformanceMetrics {
  const processingValues = documents
    .map((document) => document.processingMs)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const aiValues = documents
    .map((document) => document.aiMs)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const ocrValues = documents
    .map((document) => document.ocrMs)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    averageProcessingMs: average(processingValues),
    averageAiMs: average(aiValues),
    averageOcrMs: average(ocrValues),
  };
}

export function computeGoldenMetrics(golden?: GoldenAnalyticsInput | null): GoldenMetrics {
  const goldenTotal = golden?.total ?? 0;
  const goldenPassed = golden?.passed ?? 0;
  const goldenFailed = golden?.failed ?? 0;

  return {
    goldenTotal,
    goldenPassed,
    goldenFailed,
    goldenPassRate: goldenTotal > 0 ? percent(goldenPassed, goldenTotal) : null,
    goldenFailRate: goldenTotal > 0 ? percent(goldenFailed, goldenTotal) : null,
  };
}

export function computeAnalyticsSummary(
  documents: AnalyticsDocumentRecord[],
  golden?: GoldenAnalyticsInput | null
): AnalyticsSummary {
  return {
    version: ANALYTICS_VERSION,
    documentCount: documents.length,
    outcome: computeOutcomeMetrics(documents),
    supplier: computeSupplierMetrics(documents),
    amount: computeAmountMetrics(documents),
    trust: computeTrustMetrics(documents),
    performance: computePerformanceMetrics(documents),
    golden: computeGoldenMetrics(golden),
  };
}
