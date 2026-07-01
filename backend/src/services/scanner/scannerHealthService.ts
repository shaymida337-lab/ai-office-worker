import type { ScannerHealthDateRange } from "./scannerHealthQueries.js";
import {
  fetchScannerHealthSummary,
  hasMissingAmountSignal,
  type ScannerHealthDb,
  type ScannerHealthSummary,
} from "./scannerHealthQueries.js";
import {
  fetchScannerIsolationViolations,
  type ScannerIsolationDb,
  type ScannerIsolationViolation,
  type ScannerIsolationViolationType,
} from "./scannerIsolationChecks.js";
import {
  normalizeDecisionBucket,
  type ScannerDecisionBucket,
} from "./scannerStageTypes.js";

export const DEFAULT_SCANNER_HEALTH_RANGE_DAYS = 7;
export const DEFAULT_SCANNER_HEALTH_FAILURE_LIMIT = 20;
export const MAX_SCANNER_HEALTH_FAILURE_LIMIT = 100;

export type ScannerViolationsSummary = {
  total: number;
  bySeverity: {
    critical: number;
    warning: number;
    info: number;
  };
  byType: Record<ScannerIsolationViolationType, number>;
};

export type ScannerHealthFailedExample = {
  id: string;
  kind: "gmail_scan_item" | "financial_document_review";
  gmailMessageId: string | null;
  subject: string | null;
  reviewStatus: string;
  decisionBucket: ScannerDecisionBucket;
  failureReason: string | null;
  occurredAt: string;
};

export type ScannerHealthApiResponse = {
  organizationId: string;
  generatedAt: string;
  range: {
    from: string;
    to: string;
  };
  health: ScannerHealthSummary;
  violations: ScannerViolationsSummary;
};

export type ScannerHealthFailuresApiResponse = {
  organizationId: string;
  generatedAt: string;
  range: {
    from: string;
    to: string;
  };
  limit: number;
  totals: {
    violations: number;
    failedExamples: number;
  };
  violations: ScannerIsolationViolation[];
  failedExamples: ScannerHealthFailedExample[];
};

export type ScannerHealthServiceDb = ScannerHealthDb & ScannerIsolationDb & ScannerFailedExamplesDb;

export type ScannerFailedExamplesDb = {
  gmailScanItem: Pick<
    ScannerHealthDb["gmailScanItem"],
    "findMany"
  >;
  financialDocumentReview: Pick<
    ScannerIsolationDb["financialDocumentReview"],
    "findMany"
  >;
};

function emptyViolationsByType(): Record<ScannerIsolationViolationType, number> {
  return {
    stuck_active_scan: 0,
    duplicate_supplier_payment_fingerprint: 0,
    blocked_outcome_persisted: 0,
    auto_saved_without_attachment: 0,
    drive_link_invoice_confusion: 0,
    fdr_without_gsi: 0,
    cross_org_gmail_message_id: 0,
    gmail_mailbox_mismatch: 0,
  };
}

export function summarizeScannerViolations(
  violations: ScannerIsolationViolation[],
): ScannerViolationsSummary {
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const byType = emptyViolationsByType();
  for (const violation of violations) {
    bySeverity[violation.severity] += 1;
    byType[violation.violationType] += 1;
  }
  return {
    total: violations.length,
    bySeverity,
    byType,
  };
}

export function parseScannerHealthLimit(
  value: unknown,
  defaultLimit = DEFAULT_SCANNER_HEALTH_FAILURE_LIMIT,
  maxLimit = MAX_SCANNER_HEALTH_FAILURE_LIMIT,
): number {
  if (value == null || value === "") return defaultLimit;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

export function parseScannerHealthRange(
  query: Record<string, unknown>,
  now: Date = new Date(),
): ScannerHealthDateRange {
  const defaultFrom = new Date(now.getTime() - DEFAULT_SCANNER_HEALTH_RANGE_DAYS * 24 * 60 * 60 * 1000);
  const from = parseIsoDate(query.from) ?? defaultFrom;
  const to = parseIsoDate(query.to) ?? now;
  if (from.getTime() > to.getTime()) {
    return { from: to, to: from };
  }
  return { from, to };
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isFailedGmailScanItem(item: {
  reviewStatus: string;
  documentType: string;
  amount: number | null;
  decisionReason: string;
  parsedFieldsJson: unknown;
}): boolean {
  const bucket = normalizeDecisionBucket({
    reviewStatus: item.reviewStatus,
    outcomeStatus:
      item.parsedFieldsJson &&
      typeof item.parsedFieldsJson === "object" &&
      !Array.isArray(item.parsedFieldsJson)
        ? String((item.parsedFieldsJson as { outcome?: { status?: unknown } }).outcome?.status ?? "")
        : null,
    uncertaintyReason: item.decisionReason,
    reasonCode:
      item.parsedFieldsJson &&
      typeof item.parsedFieldsJson === "object" &&
      !Array.isArray(item.parsedFieldsJson)
        ? String((item.parsedFieldsJson as { outcome?: { reasonCode?: unknown } }).outcome?.reasonCode ?? "")
        : null,
  });
  if (bucket !== "auto_save" && bucket !== "unknown") return true;
  if (item.reviewStatus === "needs_review" || item.reviewStatus === "rejected") return true;
  return hasMissingAmountSignal(item);
}

function isFailedFinancialDocumentReview(review: {
  reviewStatus: string;
  uncertaintyReason: string | null;
  parsedFieldsJson: unknown;
}): boolean {
  if (review.reviewStatus === "needs_review" || review.reviewStatus === "rejected") return true;
  const bucket = normalizeDecisionBucket({
    reviewStatus: review.reviewStatus,
    outcomeStatus:
      review.parsedFieldsJson &&
      typeof review.parsedFieldsJson === "object" &&
      !Array.isArray(review.parsedFieldsJson)
        ? String((review.parsedFieldsJson as { outcome?: { status?: unknown } }).outcome?.status ?? "")
        : null,
    uncertaintyReason: review.uncertaintyReason,
    reasonCode:
      review.parsedFieldsJson &&
      typeof review.parsedFieldsJson === "object" &&
      !Array.isArray(review.parsedFieldsJson)
        ? String((review.parsedFieldsJson as { outcome?: { reasonCode?: unknown } }).outcome?.reasonCode ?? "")
        : null,
  });
  return bucket === "blocked" || bucket === "duplicate" || bucket === "unsupported";
}

export async function fetchScannerHealthFailedExamples(
  db: ScannerFailedExamplesDb,
  input: {
    organizationId: string;
    range: ScannerHealthDateRange;
    limit: number;
  },
): Promise<ScannerHealthFailedExample[]> {
  const createdAtFilter = {
    gte: input.range.from,
    lte: input.range.to,
  };

  const [scanItems, reviews] = await Promise.all([
    db.gmailScanItem.findMany({
      where: {
        organizationId: input.organizationId,
        createdAt: createdAtFilter,
      },
      select: {
        id: true,
        gmailMessageId: true,
        subject: true,
        reviewStatus: true,
        documentType: true,
        amount: true,
        decisionReason: true,
        parsedFieldsJson: true,
        occurredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(input.limit * 3, input.limit),
    }),
    db.financialDocumentReview.findMany({
      where: {
        organizationId: input.organizationId,
        createdAt: createdAtFilter,
      },
      select: {
        id: true,
        gmailMessageId: true,
        subject: true,
        reviewStatus: true,
        uncertaintyReason: true,
        parsedFieldsJson: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(input.limit * 3, input.limit),
    }),
  ]);

  const examples: ScannerHealthFailedExample[] = [];

  for (const item of scanItems) {
    if (!isFailedGmailScanItem(item)) continue;
    examples.push({
      id: item.id,
      kind: "gmail_scan_item",
      gmailMessageId: item.gmailMessageId,
      subject: item.subject,
      reviewStatus: item.reviewStatus,
      decisionBucket: normalizeDecisionBucket({
        reviewStatus: item.reviewStatus,
        outcomeStatus:
          item.parsedFieldsJson &&
          typeof item.parsedFieldsJson === "object" &&
          !Array.isArray(item.parsedFieldsJson)
            ? String((item.parsedFieldsJson as { outcome?: { status?: unknown } }).outcome?.status ?? "")
            : null,
        uncertaintyReason: item.decisionReason,
      }),
      failureReason: item.decisionReason,
      occurredAt: item.occurredAt.toISOString(),
    });
  }

  for (const review of reviews) {
    if (!isFailedFinancialDocumentReview(review)) continue;
    examples.push({
      id: review.id,
      kind: "financial_document_review",
      gmailMessageId: review.gmailMessageId,
      subject: review.subject,
      reviewStatus: review.reviewStatus,
      decisionBucket: normalizeDecisionBucket({
        reviewStatus: review.reviewStatus,
        outcomeStatus:
          review.parsedFieldsJson &&
          typeof review.parsedFieldsJson === "object" &&
          !Array.isArray(review.parsedFieldsJson)
            ? String((review.parsedFieldsJson as { outcome?: { status?: unknown } }).outcome?.status ?? "")
            : null,
        uncertaintyReason: review.uncertaintyReason,
      }),
      failureReason: review.uncertaintyReason,
      occurredAt: review.createdAt.toISOString(),
    });
  }

  examples.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  return examples.slice(0, input.limit);
}

export async function getScannerHealthResponse(
  db: ScannerHealthServiceDb,
  input: {
    organizationId: string;
    range: ScannerHealthDateRange;
    now?: Date;
  },
): Promise<ScannerHealthApiResponse> {
  const now = input.now ?? new Date();
  const [health, violations] = await Promise.all([
    fetchScannerHealthSummary(db, {
      organizationId: input.organizationId,
      range: input.range,
      now,
    }),
    fetchScannerIsolationViolations(db, {
      organizationId: input.organizationId,
      range: input.range,
      now,
    }),
  ]);

  return {
    organizationId: input.organizationId,
    generatedAt: now.toISOString(),
    range: {
      from: input.range.from.toISOString(),
      to: input.range.to.toISOString(),
    },
    health,
    violations: summarizeScannerViolations(violations),
  };
}

export async function getScannerHealthFailuresResponse(
  db: ScannerHealthServiceDb,
  input: {
    organizationId: string;
    range: ScannerHealthDateRange;
    limit: number;
    now?: Date;
  },
): Promise<ScannerHealthFailuresApiResponse> {
  const now = input.now ?? new Date();
  const [violations, failedExamples] = await Promise.all([
    fetchScannerIsolationViolations(db, {
      organizationId: input.organizationId,
      range: input.range,
      now,
    }),
    fetchScannerHealthFailedExamples(db, {
      organizationId: input.organizationId,
      range: input.range,
      limit: input.limit,
    }),
  ]);

  return {
    organizationId: input.organizationId,
    generatedAt: now.toISOString(),
    range: {
      from: input.range.from.toISOString(),
      to: input.range.to.toISOString(),
    },
    limit: input.limit,
    totals: {
      violations: violations.length,
      failedExamples: failedExamples.length,
    },
    violations: violations.slice(0, input.limit),
    failedExamples,
  };
}
