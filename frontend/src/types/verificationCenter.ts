export type VerificationOutcomeStatus =
  | "SAVED"
  | "NEEDS_REVIEW"
  | "BLOCKED"
  | "DUPLICATE"
  | "NOT_FINANCIAL"
  | "ERROR";

export type VerificationTimelineStage = {
  id: "received" | "ai" | "scfc" | "arc" | "sir" | "fse" | "trust" | "outcome";
  label: string;
  status: "completed" | "warning" | "failed" | "skipped" | "pending" | "unknown";
  confidence: number | null;
  reason: string | null;
  durationMs: number | null;
  summary: string | null;
};

export type VerificationDocumentSummary = {
  documentId: string;
  source: "gmail_scan_item" | "financial_document_review" | "supplier_payment";
  createdAt: string;
  supplier: string | null;
  amount: number | null;
  documentType: string | null;
  reviewStatus: string | null;
  outcomeStatus: VerificationOutcomeStatus;
  trustConfidence: number | null;
  arcConfidence: number | null;
  sirConfidence: number | null;
  fseTrust: number | null;
  goldenMatch: null;
  invoiceNumberMasked: string | null;
  gmailMessageIdPrefix: string | null;
  timeline: VerificationTimelineStage[];
};

export type VerificationCenterResponse = {
  version: string;
  dateRange: { days: 7 | 30 | 90; from: string; to: string };
  documents: VerificationDocumentSummary[];
  nextCursor: string | null;
  totalReturned: number;
};

export type VerificationQueryState = {
  days: "7" | "30" | "90";
  limit: string;
  outcome: string;
  review: string;
  supplier: string;
  blocked: boolean;
  duplicate: boolean;
  confidence: string;
  search: string;
};
