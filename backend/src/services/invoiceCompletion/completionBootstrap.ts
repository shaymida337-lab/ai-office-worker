/**
 * Invoice-completion First Paint bootstrap — meta only (no rows, no Google API).
 */
import type { CompletionListCandidateLike } from "./completionList.js";

export const COMPLETION_BOOTSTRAP_MAX_PAYLOAD_BYTES = 50 * 1024;

export const COMPLETION_FILTER_STATUSES = ["all", "needs_review", "approved", "rejected"] as const;
export const COMPLETION_FILTER_SOURCES = [
  "gmail_scan_item",
  "financial_document_review",
  "supplier_payment",
] as const;
export const COMPLETION_MISSING_FIELD_KEYS = [
  "supplier",
  "amount",
  "date",
  "currency",
  "documentType",
  "other",
] as const;

export type CompletionMissingFieldCategory = {
  key: (typeof COMPLETION_MISSING_FIELD_KEYS)[number];
  count: number;
};

export type CompletionBootstrapPayload = {
  counts: {
    incomplete: number;
    byStatus: Record<string, number>;
  };
  availableFilters: {
    statuses: readonly string[];
    sources: readonly string[];
    missingFieldKeys: readonly string[];
  };
  missingFieldCategories: CompletionMissingFieldCategory[];
  generatedAt: string;
  /** True only when source scan hit the hard safety ceiling (not an approximate count). */
  truncated?: boolean;
};

function categorizeMissing(candidate: CompletionListCandidateLike): Set<(typeof COMPLETION_MISSING_FIELD_KEYS)[number]> {
  const keys = new Set<(typeof COMPLETION_MISSING_FIELD_KEYS)[number]>();
  const reasons = Array.isArray(candidate.missingDataReasons) ? candidate.missingDataReasons : [];
  if (reasons.length === 0) return keys;
  for (const reason of reasons) {
    if (reason.includes("ספק")) keys.add("supplier");
    else if (reason.includes("סכום")) keys.add("amount");
    else if (reason.includes("תאריך")) keys.add("date");
    else if (reason.includes("מטבע")) keys.add("currency");
    else if (reason.includes("סוג מסמך")) keys.add("documentType");
    else keys.add("other");
  }
  return keys;
}

/**
 * Build bootstrap meta from already-filtered completion-queue candidates.
 * No Google API. Does not return rows.
 */
export function buildCompletionBootstrapPayload(
  candidates: CompletionListCandidateLike[],
  options?: { now?: Date; truncated?: boolean }
): CompletionBootstrapPayload {
  const byStatus: Record<string, number> = {};
  const missingCounts = new Map<string, number>();
  for (const key of COMPLETION_MISSING_FIELD_KEYS) missingCounts.set(key, 0);

  for (const candidate of candidates) {
    const status = candidate.reviewStatus || candidate.status || "unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    for (const key of categorizeMissing(candidate)) {
      missingCounts.set(key, (missingCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    counts: {
      incomplete: candidates.length,
      byStatus,
    },
    availableFilters: {
      statuses: [...COMPLETION_FILTER_STATUSES],
      sources: [...COMPLETION_FILTER_SOURCES],
      missingFieldKeys: [...COMPLETION_MISSING_FIELD_KEYS],
    },
    missingFieldCategories: COMPLETION_MISSING_FIELD_KEYS.map((key) => ({
      key,
      count: missingCounts.get(key) ?? 0,
    })),
    generatedAt: (options?.now ?? new Date()).toISOString(),
    ...(options?.truncated ? { truncated: true } : {}),
  };
}

export function assertCompletionBootstrapPayloadBounds(payload: CompletionBootstrapPayload): void {
  if ("rows" in payload || "invoices" in payload) {
    throw new Error("completion bootstrap must not include rows");
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > COMPLETION_BOOTSTRAP_MAX_PAYLOAD_BYTES) {
    throw new Error(`completion bootstrap payload ${bytes} bytes exceeds ${COMPLETION_BOOTSTRAP_MAX_PAYLOAD_BYTES}`);
  }
  if (payload.counts.incomplete < 0) {
    throw new Error("incomplete count must not be negative");
  }
}
