import type { DocumentOutcomeStatus } from "../outcome/outcomeTypes.js";

/** Five-stage Natalie scanner pipeline (health + golden contract). */
export const SCANNER_PIPELINE_STAGES = [
  "ingestion",
  "classification",
  "extraction",
  "decision",
  "persistence",
] as const;

export type ScannerPipelineStage = (typeof SCANNER_PIPELINE_STAGES)[number];

/** Normalized per-stage result for observability. */
export const SCANNER_STAGE_STATUSES = [
  "success",
  "failed",
  "skipped",
  "rejected",
  "partial",
  "error",
  "unknown",
] as const;

export type ScannerStageStatus = (typeof SCANNER_STAGE_STATUSES)[number];

/** Canonical review statuses stored on GSI/FDR rows (normalized casing). */
export const SCANNER_REVIEW_STATUSES = [
  "auto_saved",
  "needs_review",
  "rejected",
  "approved",
  "unsupported",
  "unknown",
] as const;

export type ScannerReviewStatus = (typeof SCANNER_REVIEW_STATUSES)[number];

/** Health/decision buckets used by Scanner Health + Core Golden Suite. */
export const SCANNER_DECISION_BUCKETS = [
  "auto_save",
  "needs_review",
  "rejected",
  "duplicate",
  "blocked",
  "unsupported",
  "unknown",
] as const;

export type ScannerDecisionBucket = (typeof SCANNER_DECISION_BUCKETS)[number];

export type ScannerDecisionSignals = {
  reviewStatus?: string | null;
  outcomeStatus?: string | null;
  uncertaintyReason?: string | null;
  reasonCode?: string | null;
};

const DRIVE_LINK_UNSUPPORTED_MARKERS = [
  "drive_link.unsupported",
  "unsupported_drive_link",
] as const;

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function containsDriveLinkUnsupportedMarker(...values: Array<string | null | undefined>): boolean {
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized) continue;
    if (DRIVE_LINK_UNSUPPORTED_MARKERS.some((marker) => normalized.includes(marker))) {
      return true;
    }
  }
  return false;
}

function normalizeOutcomeStatus(
  outcomeStatus: string | null | undefined,
): DocumentOutcomeStatus | null {
  const normalized = normalizeToken(outcomeStatus)?.toUpperCase();
  if (!normalized) return null;
  switch (normalized) {
    case "SAVED":
    case "NEEDS_REVIEW":
    case "DUPLICATE":
    case "NOT_FINANCIAL":
    case "ERROR":
    case "BLOCKED":
      return normalized;
    default:
      return null;
  }
}

export function isScannerPipelineStage(value: string): value is ScannerPipelineStage {
  return (SCANNER_PIPELINE_STAGES as readonly string[]).includes(value);
}

export function isScannerStageStatus(value: string): value is ScannerStageStatus {
  return (SCANNER_STAGE_STATUSES as readonly string[]).includes(value);
}

export function isScannerReviewStatus(value: string): value is ScannerReviewStatus {
  return (SCANNER_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isScannerDecisionBucket(value: string): value is ScannerDecisionBucket {
  return (SCANNER_DECISION_BUCKETS as readonly string[]).includes(value);
}

/**
 * Normalize raw reviewStatus values from GSI/FDR/classifier into canonical scanner review statuses.
 */
export function normalizeReviewStatus(
  reviewStatus: string | null | undefined,
): ScannerReviewStatus {
  const normalized = normalizeToken(reviewStatus);
  if (!normalized) return "unknown";

  if (normalized === "auto_saved" || normalized === "auto-save" || normalized === "autosaved") {
    return "auto_saved";
  }
  if (normalized === "needs_review" || normalized === "needs-review" || normalized === "needsreview") {
    return "needs_review";
  }
  if (normalized === "rejected") return "rejected";
  if (normalized === "approved") return "approved";
  if (normalized === "unsupported" || normalized === "unsupported_drive_link") {
    return "unsupported";
  }

  return "unknown";
}

/**
 * Map heterogeneous scanner signals to a single decision bucket for health metrics.
 * Precedence: unsupported > duplicate > blocked > rejected > auto_save > needs_review > unknown.
 */
export function normalizeDecisionBucket(
  signals: ScannerDecisionSignals | string | null | undefined,
): ScannerDecisionBucket {
  if (signals == null) return "unknown";
  if (typeof signals === "string") {
    return normalizeDecisionBucket({ reviewStatus: signals });
  }

  const reviewStatus = normalizeReviewStatus(signals.reviewStatus);
  const outcomeStatus = normalizeOutcomeStatus(signals.outcomeStatus);

  if (
    containsDriveLinkUnsupportedMarker(
      signals.uncertaintyReason,
      signals.reasonCode,
      signals.reviewStatus,
    ) ||
    reviewStatus === "unsupported"
  ) {
    return "unsupported";
  }

  if (outcomeStatus === "DUPLICATE") return "duplicate";
  if (outcomeStatus === "BLOCKED") return "blocked";

  if (reviewStatus === "rejected" || outcomeStatus === "NOT_FINANCIAL") {
    return "rejected";
  }
  if (outcomeStatus === "ERROR") return "rejected";

  if (reviewStatus === "auto_saved") return "auto_save";
  if (reviewStatus === "needs_review" || outcomeStatus === "NEEDS_REVIEW") {
    return "needs_review";
  }
  if (outcomeStatus === "SAVED") return "auto_save";

  return "unknown";
}

/**
 * Normalize arbitrary stage status strings emitted by future tracing/logging.
 */
export function normalizeScannerStageStatus(
  stageStatus: string | null | undefined,
): ScannerStageStatus {
  const normalized = normalizeToken(stageStatus);
  if (!normalized) return "unknown";

  if (
    normalized === "success" ||
    normalized === "ok" ||
    normalized === "completed" ||
    normalized === "complete"
  ) {
    return "success";
  }
  if (normalized === "failed" || normalized === "fail" || normalized === "failure") {
    return "failed";
  }
  if (normalized === "skipped" || normalized === "skip") return "skipped";
  if (normalized === "rejected" || normalized === "reject") return "rejected";
  if (normalized === "partial") return "partial";
  if (normalized === "error" || normalized === "errored") return "error";

  return "unknown";
}
