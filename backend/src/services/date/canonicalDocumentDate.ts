/**
 * CANONICAL FINANCIAL DOCUMENT DATE ENGINE
 *
 * Establishes the hard financial date contract:
 * DOCUMENT-FACE FINANCIAL DATES (issueDate, dueDate, serviceDate)
 * !=
 * TRANSPORT / SYSTEM METADATA (emailSentAt, emailReceivedAt, createdAt, ingestedAt)
 *
 * Transport metadata must NEVER be silently used as an issueDate fallback.
 * If issueDate is missing or ambiguous, value remains null and routes to FIELD_REVIEW.
 */

export type CanonicalDateStatus =
  | "resolved"
  | "missing"
  | "ambiguous"
  | "invalid";

export type CanonicalDateSemanticType =
  | "issue_date"
  | "due_date"
  | "service_date";

export type DateCandidateSource =
  | "structured"
  | "pdf_text"
  | "ocr"
  | "vision"
  | "llm"
  | "rule";

export type DateCandidate = {
  semanticType: CanonicalDateSemanticType;
  rawText: string;
  normalizedValue: string | null; // YYYY-MM-DD
  source: DateCandidateSource;
  confidence?: number | null;
  pageIndex?: number | null;
  evidenceLabel?: string | null;
};

export type CanonicalDateDecision = {
  value: string | null; // YYYY-MM-DD or null
  semanticType: CanonicalDateSemanticType;
  status: CanonicalDateStatus;
  confidence: number | null;
  source: DateCandidateSource | null;
  candidates: DateCandidate[];
  reasonCode: string;
  resolverVersion: string;
};

export const CANONICAL_DATE_RESOLVER_VERSION = "cdd-v1.0.0";

/**
 * Validates whether a YYYY-MM-DD string is a valid calendar date.
 */
export function isValidCalendarDateString(dateStr: string | null | undefined): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1990 || year > 2099) return false;

  const dateObj = new Date(Date.UTC(year, month - 1, day));
  return (
    dateObj.getUTCFullYear() === year &&
    dateObj.getUTCMonth() === month - 1 &&
    dateObj.getUTCDate() === day
  );
}

/**
 * Attempts to parse raw date text into YYYY-MM-DD.
 * Handles ISO format (YYYY-MM-DD), slash formats (DD/MM/YYYY, YYYY/MM/DD), and Hebrew date labels.
 * Returns null if string is unparseable or ambiguous without context.
 */
export function normalizeRawDateToIso(rawText: string | null | undefined): {
  normalized: string | null;
  isAmbiguous: boolean;
} {
  if (!rawText) return { normalized: null, isAmbiguous: false };
  const trimmed = rawText.trim();

  // Standard YYYY-MM-DD ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isValidCalendarDateString(trimmed)
      ? { normalized: trimmed, isAmbiguous: false }
      : { normalized: null, isAmbiguous: false };
  }

  // ISO with slashes YYYY/MM/DD
  const isoSlashMatch = trimmed.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (isoSlashMatch) {
    const y = isoSlashMatch[1];
    const m = isoSlashMatch[2].padStart(2, "0");
    const d = isoSlashMatch[3].padStart(2, "0");
    const formatted = `${y}-${m}-${d}`;
    return isValidCalendarDateString(formatted)
      ? { normalized: formatted, isAmbiguous: false }
      : { normalized: null, isAmbiguous: false };
  }

  // DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})$/);
  if (slashMatch) {
    const first = parseInt(slashMatch[1], 10);
    const second = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);

    // If first > 12, it must be DD/MM/YYYY
    if (first > 12 && first <= 31 && second >= 1 && second <= 12) {
      const formatted = `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
      return isValidCalendarDateString(formatted)
        ? { normalized: formatted, isAmbiguous: false }
        : { normalized: null, isAmbiguous: false };
    }

    // If second > 12, it must be MM/DD/YYYY
    if (second > 12 && second <= 31 && first >= 1 && first <= 12) {
      const formatted = `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
      return isValidCalendarDateString(formatted)
        ? { normalized: formatted, isAmbiguous: false }
        : { normalized: null, isAmbiguous: false };
    }

    // Both first and second <= 12 (e.g. 03/04/2026) -> Ambiguous numeric date!
    if (first <= 12 && second <= 12 && first !== second) {
      // Default Israeli locale interpretation is DD/MM/YYYY if no other context, but flag as ambiguous
      const defaultDdMm = `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
      return isValidCalendarDateString(defaultDdMm)
        ? { normalized: defaultDdMm, isAmbiguous: true }
        : { normalized: null, isAmbiguous: false };
    }

    if (first === second && first >= 1 && first <= 12) {
      const formatted = `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
      return isValidCalendarDateString(formatted)
        ? { normalized: formatted, isAmbiguous: false }
        : { normalized: null, isAmbiguous: false };
    }
  }

  return { normalized: null, isAmbiguous: false };
}

/**
 * Canonical Date Resolver
 * Resolves DateCandidates for a given semantic date type (issue_date, due_date, service_date).
 * Transport timestamps must NEVER be passed as candidate inputs for issue_date.
 */
export function resolveCanonicalDocumentDate(
  candidates: DateCandidate[],
  semanticType: CanonicalDateSemanticType = "issue_date"
): CanonicalDateDecision {
  const filtered = candidates.filter((c) => c.semanticType === semanticType);

  if (filtered.length === 0) {
    return {
      value: null,
      semanticType,
      status: "missing",
      confidence: 0,
      source: null,
      candidates,
      reasonCode: "MISSING_DATE",
      resolverVersion: CANONICAL_DATE_RESOLVER_VERSION,
    };
  }

  // Inspect candidates with normalized value or attempt normalization
  const validCandidates: { candidate: DateCandidate; normalized: string; isAmbiguous: boolean }[] = [];

  for (const candidate of filtered) {
    let norm = candidate.normalizedValue;
    let ambiguous = false;

    if (!norm) {
      const parsed = normalizeRawDateToIso(candidate.rawText);
      norm = parsed.normalized;
      ambiguous = parsed.isAmbiguous;
    }

    if (norm && isValidCalendarDateString(norm)) {
      validCandidates.push({ candidate, normalized: norm, isAmbiguous: ambiguous });
    }
  }

  if (validCandidates.length === 0) {
    return {
      value: null,
      semanticType,
      status: "invalid",
      confidence: 0,
      source: filtered[0].source,
      candidates,
      reasonCode: "INVALID_DATE_FORMAT",
      resolverVersion: CANONICAL_DATE_RESOLVER_VERSION,
    };
  }

  // Check if top valid candidates conflict with distinct normalized dates
  const distinctDates = new Set(validCandidates.map((v) => v.normalized));
  if (distinctDates.size > 1) {
    // Conflict exists between document date candidates
    const topCandidate = validCandidates[0];
    return {
      value: null,
      semanticType,
      status: "ambiguous",
      confidence: 0.5,
      source: topCandidate.candidate.source,
      candidates,
      reasonCode: "CONFLICTING_DOCUMENT_DATES",
      resolverVersion: CANONICAL_DATE_RESOLVER_VERSION,
    };
  }

  const selected = validCandidates[0];

  if (selected.isAmbiguous) {
    return {
      value: selected.normalized,
      semanticType,
      status: "resolved",
      confidence: selected.candidate.confidence ?? 0.7,
      source: selected.candidate.source,
      candidates,
      reasonCode: "NUMERIC_DATE_RESOLVED_LOCALE_DEFAULT",
      resolverVersion: CANONICAL_DATE_RESOLVER_VERSION,
    };
  }

  return {
    value: selected.normalized,
    semanticType,
    status: "resolved",
    confidence: selected.candidate.confidence ?? 1.0,
    source: selected.candidate.source,
    candidates,
    reasonCode: "RESOLVED_EXPLICIT_DOCUMENT_DATE",
    resolverVersion: CANONICAL_DATE_RESOLVER_VERSION,
  };
}
