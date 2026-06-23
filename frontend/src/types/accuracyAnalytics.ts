export type AccuracyAnalyticsSource = "gmail" | "all";

export type AccuracyAnalyticsDateRange = {
  days: 7 | 30 | 90;
  from: string;
  to: string;
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

export type AccuracyAnalyticsResponse = {
  version: string;
  dateRange: AccuracyAnalyticsDateRange;
  source: AccuracyAnalyticsSource;
  documentCount: number;
  outcome: OutcomeMetrics;
  supplier: SupplierMetrics;
  amount: AmountMetrics;
  trust: TrustMetrics;
  performance: PerformanceMetrics;
  golden: GoldenMetrics;
};
