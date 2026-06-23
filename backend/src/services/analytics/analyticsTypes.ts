import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";

export const ANALYTICS_VERSION = "analytics-v1" as const;

export const SUSPICIOUS_AMOUNT_THRESHOLD = 100_000;

export type AnalyticsDocumentRecord = {
  id: string;
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

export type GoldenAnalyticsInput = {
  total: number;
  passed: number;
  failed: number;
};

export type OutcomeMetrics = {
  totalDocuments: number;
  savedCount: number;
  reviewCount: number;
  blockedCount: number;
  duplicateCount: number;
  errorCount: number;
  notFinancialCount: number;
  savedPercent: number;
  reviewPercent: number;
  blockedPercent: number;
  duplicatePercent: number;
  errorPercent: number;
  notFinancialPercent: number;
};

export type SupplierMetrics = {
  unknownSupplierCount: number;
  supplierResolvedCount: number;
  supplierResolutionRate: number;
  unknownSupplierPercent: number;
};

export type AmountMetrics = {
  zeroAmountCount: number;
  suspiciousAmountCount: number;
  averageAmount: number | null;
  zeroAmountPercent: number;
  suspiciousAmountPercent: number;
};

export type TrustMetrics = {
  averageTrustConfidence: number | null;
  averageArcConfidence: number | null;
  averageSirConfidence: number | null;
  averageFseTrust: number | null;
};

export type PerformanceMetrics = {
  averageProcessingMs: number | null;
  averageAiMs: number | null;
  averageOcrMs: number | null;
};

export type GoldenMetrics = {
  goldenTotal: number;
  goldenPassed: number;
  goldenFailed: number;
  goldenPassRate: number | null;
  goldenFailRate: number | null;
};

export type AnalyticsSummary = {
  version: typeof ANALYTICS_VERSION;
  documentCount: number;
  outcome: OutcomeMetrics;
  supplier: SupplierMetrics;
  amount: AmountMetrics;
  trust: TrustMetrics;
  performance: PerformanceMetrics;
  golden: GoldenMetrics;
};
