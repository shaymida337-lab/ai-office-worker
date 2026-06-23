import type { VerificationDocumentSummary, VerificationOutcomeStatus } from "@/types/verificationCenter";

export function formatVerificationPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatVerificationAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

export function formatVerificationDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatVerificationDate(value: string): string {
  return new Date(value).toLocaleString("he-IL");
}

export type VerificationBadgeTone = "saved" | "review" | "blocked" | "duplicate" | "notFinancial" | "neutral";

export function verificationBadgeTone(doc: Pick<VerificationDocumentSummary, "outcomeStatus" | "reviewStatus">): VerificationBadgeTone {
  if (doc.outcomeStatus === "SAVED") return "saved";
  if (doc.outcomeStatus === "NEEDS_REVIEW") return "review";
  if (doc.outcomeStatus === "BLOCKED" || doc.outcomeStatus === "ERROR") return "blocked";
  if (doc.outcomeStatus === "DUPLICATE") return "duplicate";
  if (doc.outcomeStatus === "NOT_FINANCIAL") return "notFinancial";
  const review = doc.reviewStatus?.toLowerCase() ?? "";
  if (review === "auto_saved" || review === "approved") return "saved";
  if (review === "duplicate") return "duplicate";
  if (review === "blocked" || review === "rejected") return "blocked";
  return "review";
}

export function verificationBadgeLabel(tone: VerificationBadgeTone): string {
  switch (tone) {
    case "saved":
      return "נשמר";
    case "review":
      return "דורש בדיקה";
    case "blocked":
      return "נחסם";
    case "duplicate":
      return "כפול";
    case "notFinancial":
      return "לא פיננסי";
    default:
      return "לא ידוע";
  }
}

export function outcomeStatusLabel(status: VerificationOutcomeStatus): string {
  return verificationBadgeLabel(verificationBadgeTone({ outcomeStatus: status, reviewStatus: null }));
}

export function buildVerificationQueryString(
  state: {
    days: string;
    limit: string;
    outcome: string;
    review: string;
    supplier: string;
    blocked: boolean;
    duplicate: boolean;
    confidence: string;
    search: string;
  },
  cursor?: string | null
): string {
  const params = new URLSearchParams();
  params.set("days", state.days);
  params.set("limit", state.limit || "25");
  if (state.outcome) params.set("outcome", state.outcome);
  if (state.review) params.set("review", state.review);
  if (state.supplier) params.set("supplier", state.supplier);
  if (state.blocked) params.set("blocked", "true");
  if (state.duplicate) params.set("duplicate", "true");
  if (state.confidence) params.set("confidence", state.confidence);
  if (state.search.trim()) params.set("search", state.search.trim());
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}
