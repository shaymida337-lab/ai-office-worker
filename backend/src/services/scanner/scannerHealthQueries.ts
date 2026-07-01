import type { PrismaClient } from "@prisma/client";
import { GMAIL_SCAN_ACTIVE_STATUSES, GMAIL_SCAN_STALE_MS } from "../gmailScanLifecycle.js";
import { isUsableSupplierNameShared } from "../supplier/supplierValidation.js";
import {
  SCANNER_DECISION_BUCKETS,
  normalizeDecisionBucket,
  type ScannerDecisionBucket,
} from "./scannerStageTypes.js";

export type ScannerHealthDateRange = {
  from: Date;
  to: Date;
};

export type ScannerHealthQueryInput = {
  organizationId: string;
  range: ScannerHealthDateRange;
  /** Reference clock for stuck-scan detection (defaults to Date.now()). */
  now?: Date;
};

export type ScannerDecisionBucketCounts = Record<ScannerDecisionBucket, number>;

export type ScannerHealthIngestionMetrics = {
  emailsIngested: number;
  emailsProcessed: number;
  ingestionSuccessRate: number | null;
};

export type ScannerHealthArtifactMetrics = {
  gmailScanItemCount: number;
  financialDocumentReviewCount: number;
};

export type ScannerHealthExtractionMetrics = {
  financialCandidateCount: number;
  amountExtractedCount: number;
  amountExtractionRate: number | null;
  supplierDetectedCount: number;
  supplierDetectionRate: number | null;
  missingAmountCount: number;
  missingAmountRate: number | null;
};

export type ScannerHealthScanMetrics = {
  stuckScanCount: number;
  scanErrorCount: number;
};

export type ScannerHealthSummary = {
  organizationId: string;
  range: {
    from: string;
    to: string;
  };
  ingestion: ScannerHealthIngestionMetrics;
  artifacts: ScannerHealthArtifactMetrics;
  extraction: ScannerHealthExtractionMetrics;
  decisions: ScannerDecisionBucketCounts;
  scans: ScannerHealthScanMetrics;
};

export type ScannerHealthGmailScanItemRow = {
  reviewStatus: string;
  documentType: string;
  amount: number | null;
  supplierName: string;
  decisionReason: string;
  parsedFieldsJson: unknown;
  createdAt: Date;
};

export type ScannerHealthSyncLogRow = {
  status: string;
  errorsCount: number;
  startedAt: Date;
};

export type ScannerHealthAggregationInput = {
  organizationId: string;
  range: ScannerHealthDateRange;
  emailsIngested: number;
  emailsProcessed: number;
  gmailScanItemCount: number;
  financialDocumentReviewCount: number;
  gmailScanItems: ScannerHealthGmailScanItemRow[];
  syncLogsInRange: ScannerHealthSyncLogRow[];
  stuckScans: ScannerHealthSyncLogRow[];
};

export type ScannerHealthDb = Pick<
  PrismaClient,
  "emailMessage" | "gmailScanItem" | "financialDocumentReview" | "syncLog"
>;

const FINANCIAL_DOCUMENT_TYPES = new Set([
  "invoice",
  "receipt",
  "payment_request",
  "tax_invoice",
  "tax_invoice_receipt",
  "quote",
  "supplier_message",
]);

const MISSING_AMOUNT_REASON_MARKERS = [
  "amount_not_found",
  "amount.arc_missing",
  "amount.unresolved",
  "amount.zero",
  "amount.invalid",
] as const;

function toIso(date: Date): string {
  return date.toISOString();
}

function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function emptyDecisionBucketCounts(): ScannerDecisionBucketCounts {
  return Object.fromEntries(
    SCANNER_DECISION_BUCKETS.map((bucket) => [bucket, 0]),
  ) as ScannerDecisionBucketCounts;
}

export function isFinancialDocumentType(documentType: string): boolean {
  const normalized = documentType.trim().toLowerCase();
  if (!normalized || normalized === "unknown_needs_review") return false;
  if (FINANCIAL_DOCUMENT_TYPES.has(normalized)) return true;
  return normalized.includes("invoice") || normalized.includes("receipt");
}

function parsedReasons(parsedFieldsJson: unknown): string[] {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || Array.isArray(parsedFieldsJson)) {
    return [];
  }
  const reasons = (parsedFieldsJson as { reasons?: unknown }).reasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.filter((reason): reason is string => typeof reason === "string");
}

function outcomeSignalsFromParsedFields(parsedFieldsJson: unknown): {
  outcomeStatus: string | null;
  reasonCode: string | null;
} {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || Array.isArray(parsedFieldsJson)) {
    return { outcomeStatus: null, reasonCode: null };
  }
  const outcome = (parsedFieldsJson as { outcome?: { status?: unknown; reasonCode?: unknown } }).outcome;
  return {
    outcomeStatus: typeof outcome?.status === "string" ? outcome.status : null,
    reasonCode: typeof outcome?.reasonCode === "string" ? outcome.reasonCode : null,
  };
}

export function hasMissingAmountSignal(item: {
  amount: number | null;
  documentType: string;
  parsedFieldsJson: unknown;
}): boolean {
  if (!isFinancialDocumentType(item.documentType)) return false;
  if (item.amount != null && Number.isFinite(item.amount)) return false;
  const reasons = parsedReasons(item.parsedFieldsJson);
  if (reasons.some((reason) => MISSING_AMOUNT_REASON_MARKERS.some((marker) => reason.includes(marker)))) {
    return true;
  }
  return item.amount == null;
}

export function isSupplierDetected(supplierName: string): boolean {
  return isUsableSupplierNameShared(supplierName);
}

export function isAmountExtracted(amount: number | null): boolean {
  return amount != null && Number.isFinite(amount);
}

export function decisionSignalsFromGmailScanItem(
  item: Pick<ScannerHealthGmailScanItemRow, "reviewStatus" | "decisionReason" | "parsedFieldsJson">,
) {
  const outcome = outcomeSignalsFromParsedFields(item.parsedFieldsJson);
  return {
    reviewStatus: item.reviewStatus,
    outcomeStatus: outcome.outcomeStatus,
    uncertaintyReason: item.decisionReason,
    reasonCode: outcome.reasonCode,
  };
}

export function aggregateDecisionBuckets(
  items: Array<Pick<ScannerHealthGmailScanItemRow, "reviewStatus" | "decisionReason" | "parsedFieldsJson">>,
): ScannerDecisionBucketCounts {
  const counts = emptyDecisionBucketCounts();
  for (const item of items) {
    const bucket = normalizeDecisionBucket(decisionSignalsFromGmailScanItem(item));
    counts[bucket] += 1;
  }
  return counts;
}

export function aggregateExtractionMetrics(
  items: ScannerHealthGmailScanItemRow[],
): ScannerHealthExtractionMetrics {
  const financialCandidates = items.filter((item) => isFinancialDocumentType(item.documentType));
  const amountExtractedCount = financialCandidates.filter((item) => isAmountExtracted(item.amount)).length;
  const supplierDetectedCount = financialCandidates.filter((item) =>
    isSupplierDetected(item.supplierName),
  ).length;
  const missingAmountCount = financialCandidates.filter((item) => hasMissingAmountSignal(item)).length;
  const financialCandidateCount = financialCandidates.length;

  return {
    financialCandidateCount,
    amountExtractedCount,
    amountExtractionRate: safeRate(amountExtractedCount, financialCandidateCount),
    supplierDetectedCount,
    supplierDetectionRate: safeRate(supplierDetectedCount, financialCandidateCount),
    missingAmountCount,
    missingAmountRate: safeRate(missingAmountCount, financialCandidateCount),
  };
}

export function isStuckGmailScan(
  log: Pick<ScannerHealthSyncLogRow, "status" | "startedAt">,
  now: Date,
  staleMs: number = GMAIL_SCAN_STALE_MS,
): boolean {
  if (!(GMAIL_SCAN_ACTIVE_STATUSES as readonly string[]).includes(log.status)) return false;
  return log.startedAt.getTime() <= now.getTime() - staleMs;
}

export function countScanErrors(syncLogs: ScannerHealthSyncLogRow[]): number {
  return syncLogs.reduce((total, log) => total + Math.max(0, log.errorsCount ?? 0), 0);
}

export function buildScannerHealthSummary(
  input: ScannerHealthAggregationInput,
): ScannerHealthSummary {
  const extraction = aggregateExtractionMetrics(input.gmailScanItems);
  const decisions = aggregateDecisionBuckets(input.gmailScanItems);

  return {
    organizationId: input.organizationId,
    range: {
      from: toIso(input.range.from),
      to: toIso(input.range.to),
    },
    ingestion: {
      emailsIngested: input.emailsIngested,
      emailsProcessed: input.emailsProcessed,
      ingestionSuccessRate: safeRate(input.emailsProcessed, input.emailsIngested),
    },
    artifacts: {
      gmailScanItemCount: input.gmailScanItemCount,
      financialDocumentReviewCount: input.financialDocumentReviewCount,
    },
    extraction,
    decisions,
    scans: {
      stuckScanCount: input.stuckScans.length,
      scanErrorCount: countScanErrors(input.syncLogsInRange),
    },
  };
}

export async function fetchScannerHealthSummary(
  db: ScannerHealthDb,
  input: ScannerHealthQueryInput,
): Promise<ScannerHealthSummary> {
  const now = input.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - GMAIL_SCAN_STALE_MS);
  const emailRangeFilter = {
    organizationId: input.organizationId,
    receivedAt: {
      gte: input.range.from,
      lte: input.range.to,
    },
  };
  const gsiRangeFilter = {
    organizationId: input.organizationId,
    createdAt: {
      gte: input.range.from,
      lte: input.range.to,
    },
  };
  const fdrRangeFilter = {
    organizationId: input.organizationId,
    createdAt: {
      gte: input.range.from,
      lte: input.range.to,
    },
  };
  const syncLogRangeFilter = {
    organizationId: input.organizationId,
    type: "gmail_scan",
    startedAt: {
      gte: input.range.from,
      lte: input.range.to,
    },
  };

  const [
    emailsIngested,
    emailsProcessed,
    gmailScanItemCount,
    financialDocumentReviewCount,
    gmailScanItems,
    syncLogsInRange,
    stuckScans,
  ] = await Promise.all([
    db.emailMessage.count({ where: emailRangeFilter }),
    db.emailMessage.count({
      where: {
        ...emailRangeFilter,
        processedAt: { not: null },
      },
    }),
    db.gmailScanItem.count({ where: gsiRangeFilter }),
    db.financialDocumentReview.count({ where: fdrRangeFilter }),
    db.gmailScanItem.findMany({
      where: gsiRangeFilter,
      select: {
        reviewStatus: true,
        documentType: true,
        amount: true,
        supplierName: true,
        decisionReason: true,
        parsedFieldsJson: true,
        createdAt: true,
      },
    }),
    db.syncLog.findMany({
      where: syncLogRangeFilter,
      select: {
        status: true,
        errorsCount: true,
        startedAt: true,
      },
    }),
    db.syncLog.findMany({
      where: {
        organizationId: input.organizationId,
        type: "gmail_scan",
        status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
        startedAt: { lte: staleCutoff },
      },
      select: {
        status: true,
        errorsCount: true,
        startedAt: true,
      },
    }),
  ]);

  return buildScannerHealthSummary({
    organizationId: input.organizationId,
    range: input.range,
    emailsIngested,
    emailsProcessed,
    gmailScanItemCount,
    financialDocumentReviewCount,
    gmailScanItems,
    syncLogsInRange,
    stuckScans,
  });
}
