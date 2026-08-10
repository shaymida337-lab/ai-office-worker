import { parseAmountGateFromParsedFields } from "./amountGate.js";
import { parseArcAmountSnapshot } from "./financeDisplayAmount.js";
import {
  parseDuplicateGateFromParsedFields,
  type DuplicateGateReasonCode,
  type DuplicateGateSnapshot,
} from "../dedup/duplicateGate.js";
import { isLikelyJunkSupplierName } from "../supplierNameValidation.js";
import {
  isConfidentlyNotFinancialDocument,
  textFromParsedFieldsJson,
  type ExtractedDocumentFinancialInput,
} from "../classification/financialDocumentClassification.js";

/**
 * Screen routing uses data completeness only (`isComplete` === `dataComplete`).
 *
 * השלמת חשבוניות blockers (missingDataReasons):
 * - missing Vendor OR Amount
 * - amount ambiguity / duplicate unsure|confirmed
 * - unconfirmed camera drafts
 *
 * Date / currency / document-type gaps are approvalReasons only — they do NOT
 * route to השלמה when vendor+amount are present (email sent-date is the date fallback).
 * Human review (needs_review / low confidence) alone must NOT send complete docs to השלמה.
 */
export const INVOICE_COMPLETION_REASON = {
  MISSING_AMOUNT: "חסר סכום",
  SUPPLIER_UNIDENTIFIED: "ספק לא זוהה",
  MISSING_DATE: "חסר תאריך",
  MISSING_CURRENCY: "מטבע חסר",
  MISSING_DOCUMENT_TYPE: "סוג מסמך חסר",
  MULTIPLE_AMOUNTS: "כמה סכומים נמצאו",
  DUPLICATE_UNSURE: "חשד לכפילות",
  DUPLICATE_CONFIRMED: "כפילות מאומתת",
  CAMERA_UNCONFIRMED: "ממתין לאישור צילום",
  LOW_CONFIDENCE: "רמת ביטחון נמוכה",
  USER_APPROVAL_REQUIRED: "ממתין לאישור",
} as const;

const DUPLICATE_UNSURE_REASON_CODES = new Set<DuplicateGateReasonCode>([
  "duplicate.semantic_unsure",
  "duplicate.cross_channel_unsure",
  "duplicate.email_attachment_match",
]);

const RECOGNIZED_DOCUMENT_TYPES = new Set([
  "invoice",
  "receipt",
  "tax_invoice",
  "tax_invoice_receipt",
  "payment_request",
  "credit_note",
]);

export type InvoiceCompletenessInput = {
  supplierName: string | null | undefined;
  amount: number | null | undefined;
  amountResolved: boolean;
  currency: string | null | undefined;
  currencyExplicit: boolean;
  date: Date | string | null | undefined;
  documentDateExplicit: boolean;
  documentType: string | null | undefined;
  reviewStatus: string;
  rawReviewStatus?: string | null;
  confidenceScore?: string | number | null;
  decisionReason?: string | null;
  parsedFieldsJson?: unknown;
  /** FDR/channel ingest source (`camera` | `gmail` | `whatsapp` | …). Not list entity type. */
  ingestSource?: string | null;
};

export type InvoiceCompletenessAssessment = {
  /** Required business fields present (supplier/amount/date/currency/type) and no real ambiguity/dup-unsure. */
  dataComplete: boolean;
  /** Human may still want to glance — does NOT drive invoices vs completion routing. */
  approvalRequired: boolean;
  /** Screen routing: same as dataComplete (review ≠ incomplete). */
  isComplete: boolean;
  missingDataReasons: string[];
  approvalReasons: string[];
  completionReasons: string[];
};

function hasRecognizedDocumentType(documentType: string | null | undefined): boolean {
  if (!documentType || !documentType.trim()) return false;
  return RECOGNIZED_DOCUMENT_TYPES.has(documentType.trim().toLowerCase());
}

function hasValidSupplier(supplierName: string | null | undefined): boolean {
  const cleaned = supplierName?.trim() ?? "";
  if (!cleaned) return false;
  return !isLikelyJunkSupplierName(cleaned);
}

function hasValidAmount(amount: number | null | undefined, amountResolved: boolean): boolean {
  return amountResolved && typeof amount === "number" && Number.isFinite(amount) && amount > 0;
}

function hasValidCurrency(currency: string | null | undefined, currencyExplicit: boolean): boolean {
  if (!currencyExplicit) return false;
  const cleaned = currency?.trim() ?? "";
  return cleaned.length > 0;
}

function hasValidDocumentDate(date: Date | string | null | undefined, documentDateExplicit: boolean): boolean {
  if (!documentDateExplicit) return false;
  if (!date) return false;
  const parsed = date instanceof Date ? date : new Date(date);
  return !Number.isNaN(parsed.getTime());
}

function normalizeDecisionReason(reason: string | null | undefined): string {
  return (reason ?? "")
    .toLowerCase()
    .replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasMultipleAmountSignals(input: Pick<InvoiceCompletenessInput, "parsedFieldsJson" | "decisionReason">): boolean {
  const arc = parseArcAmountSnapshot(input.parsedFieldsJson);
  if (arc?.status === "ambiguous") return true;

  const gate = parseAmountGateFromParsedFields(input.parsedFieldsJson);
  if (gate?.reasonCode === "amount.arc_ambiguous") return true;

  const reason = normalizeDecisionReason(input.decisionReason);
  return (
    reason.includes("arc ambiguous") ||
    reason.includes("ambiguous amount") ||
    reason.includes("multiple amount") ||
    reason.includes("כמה סכומים")
  );
}

export type DuplicateCompletenessBlock = "unsure" | "confirmed";

function structuredDuplicateBlock(gate: DuplicateGateSnapshot): DuplicateCompletenessBlock | null {
  if (gate.matchStrength === "unsure" || DUPLICATE_UNSURE_REASON_CODES.has(gate.reasonCode)) {
    return "unsure";
  }
  if (gate.matchStrength === "confirmed" || gate.verdict === "block") {
    return "confirmed";
  }
  return null;
}

function textDuplicateUnsureFallback(decisionReason: string | null | undefined): boolean {
  const reason = normalizeDecisionReason(decisionReason);
  return (
    reason.includes("possible duplicate") ||
    reason.includes("duplicate unsure") ||
    reason.includes("semantic unsure") ||
    reason.includes("cross channel unsure") ||
    reason.includes("duplicate.semantic_unsure") ||
    reason.includes("duplicate.cross_channel_unsure") ||
    (reason.includes("duplicate") && reason.includes("unsure"))
  );
}

/**
 * Prefer structured duplicateGate (`gates[]` via parseDuplicateGateFromParsedFields).
 * Text decisionReason is fallback only when no structured gate snapshot exists.
 */
export function resolveDuplicateCompletenessBlock(
  input: Pick<InvoiceCompletenessInput, "decisionReason" | "reviewStatus" | "rawReviewStatus" | "parsedFieldsJson">
): DuplicateCompletenessBlock | null {
  const status = (input.rawReviewStatus ?? input.reviewStatus ?? "").trim().toLowerCase();
  if (status === "duplicate") return "confirmed";

  const gate = parseDuplicateGateFromParsedFields(input.parsedFieldsJson);
  if (gate) {
    return structuredDuplicateBlock(gate);
  }

  return textDuplicateUnsureFallback(input.decisionReason) ? "unsure" : null;
}

/** True when dedup left an unresolved possible-duplicate that needs human choice. */
export function hasDuplicateUnsureSignal(
  input: Pick<InvoiceCompletenessInput, "decisionReason" | "reviewStatus" | "rawReviewStatus" | "parsedFieldsJson">
): boolean {
  return resolveDuplicateCompletenessBlock(input) === "unsure";
}

/** Camera draft / unconfirmed upload — stays on השלמה until confirm/approve. */
export function isUnconfirmedCameraIngest(
  input: Pick<InvoiceCompletenessInput, "ingestSource" | "reviewStatus" | "rawReviewStatus">
): boolean {
  const ingest = (input.ingestSource ?? "").trim().toLowerCase();
  if (ingest !== "camera") return false;
  const raw = input.rawReviewStatus ?? input.reviewStatus;
  if (isInvoiceRecordApproved(raw)) return false;
  return (raw ?? "").trim().toLowerCase() !== "rejected";
}

function hasLowConfidence(confidenceScore: string | number | null | undefined): boolean {
  if (confidenceScore == null) return false;
  if (typeof confidenceScore === "number") return confidenceScore < 0.8;
  const normalized = confidenceScore.trim().toLowerCase();
  return normalized === "low" || normalized === "medium";
}

export function isInvoiceRecordApproved(rawReviewStatus: string | null | undefined): boolean {
  const normalized = (rawReviewStatus ?? "").trim().toLowerCase();
  return normalized === "approved" || normalized === "auto_saved";
}

export function assessInvoiceCompleteness(input: InvoiceCompletenessInput): InvoiceCompletenessAssessment {
  const missingDataReasons: string[] = [];
  const approvalReasons: string[] = [];

  // Primary routing: Vendor, Amount, Date, or Recognized Document Type missing → השלמת חשבוניות.
  if (!hasValidSupplier(input.supplierName)) missingDataReasons.push(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED);
  if (!hasValidAmount(input.amount, input.amountResolved)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_AMOUNT);
  if (!hasValidDocumentDate(input.date, input.documentDateExplicit)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_DATE);
  if (!hasRecognizedDocumentType(input.documentType)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE);

  const normDocType = (input.documentType ?? "").trim().toLowerCase();
  if (normDocType === "credit_note") {
    // Credit notes are valid financial documents but require user review before posting
    approvalReasons.push(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED);
  }

  // Soft gaps: currency missing flags review without blocking when core fields exist.
  if (!hasValidCurrency(input.currency, input.currencyExplicit)) {
    approvalReasons.push(INVOICE_COMPLETION_REASON.MISSING_CURRENCY);
  }

  // Real ambiguity / unresolved duplicate are data-routing blockers — not mere review flags.
  if (hasMultipleAmountSignals(input)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS);
  const duplicateBlock = resolveDuplicateCompletenessBlock(input);
  if (duplicateBlock === "unsure") missingDataReasons.push(INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE);
  if (duplicateBlock === "confirmed") missingDataReasons.push(INVOICE_COMPLETION_REASON.DUPLICATE_CONFIRMED);

  // Camera draft / unconfirmed upload never routes to חשבוניות on data alone.
  if (isUnconfirmedCameraIngest(input)) {
    missingDataReasons.push(INVOICE_COMPLETION_REASON.CAMERA_UNCONFIRMED);
  }

  const rawStatus = input.rawReviewStatus ?? input.reviewStatus;
  const approvalRequired = !isInvoiceRecordApproved(rawStatus) && rawStatus !== "rejected";

  if (approvalRequired) {
    approvalReasons.push(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED);
    if (hasLowConfidence(input.confidenceScore)) approvalReasons.push(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE);
  }

  const dataComplete = missingDataReasons.length === 0;
  // Screen routing: data-complete invoices belong on חשבוניות even while awaiting glance/approval
  // (except camera drafts — blocked above until confirm).
  const isComplete = dataComplete;

  return {
    dataComplete,
    approvalRequired,
    isComplete,
    missingDataReasons,
    approvalReasons,
    completionReasons: [...new Set([...missingDataReasons, ...approvalReasons])],
  };
}

export type InvoiceCompletenessFilter = "complete" | "incomplete" | "all";

export function parseInvoiceCompletenessParam(value: unknown): InvoiceCompletenessFilter {
  if (value === "incomplete") return "incomplete";
  if (value === "all") return "all";
  return "complete";
}

export function filterInvoicesByCompleteness<T extends { isComplete: boolean }>(
  invoices: T[],
  completeness: InvoiceCompletenessFilter,
): T[] {
  if (completeness === "all") return invoices;
  return invoices.filter((invoice) =>
    completeness === "complete" ? invoice.isComplete : !invoice.isComplete,
  );
}

export type InvoiceCompletionQueueCandidate = {
  supplierName: string | null;
  amount: number | null;
  documentType: string | null;
  decisionReason?: string | null;
  description?: string | null;
  attachmentFilename?: string | null;
  parsedFieldsJson?: unknown;
  confidenceScore?: string | number | null;
};

function guessMimeFromFilename(filename: string | null | undefined): string | undefined {
  if (!filename) return undefined;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(jpe?g)$/.test(lower)) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  return undefined;
}

function toOcrConfidence(score: string | number | null | undefined): number | null {
  if (typeof score === "number") return score;
  if (!score) return null;
  const normalized = score.trim().toLowerCase();
  if (normalized === "low") return 0.4;
  if (normalized === "medium") return 0.7;
  if (normalized === "high") return 0.9;
  const parsed = Number(score);
  return Number.isFinite(parsed) ? parsed : null;
}

export function invoiceCandidateToFinancialInput(
  candidate: InvoiceCompletionQueueCandidate
): ExtractedDocumentFinancialInput {
  const extractedText = textFromParsedFieldsJson(candidate.parsedFieldsJson);
  return {
    documentType: candidate.documentType,
    supplierName: candidate.supplierName,
    totalAmount: candidate.amount,
    amount: candidate.amount,
    bodyText: [candidate.decisionReason, candidate.description].filter(Boolean).join("\n") || undefined,
    ocrText: extractedText ?? undefined,
    pdfText: extractedText ?? undefined,
    attachmentText: extractedText ?? undefined,
    filename: candidate.attachmentFilename ?? undefined,
    mimeType: guessMimeFromFilename(candidate.attachmentFilename),
    ocrConfidence: toOcrConfidence(candidate.confidenceScore),
    subject: candidate.description ?? undefined,
  };
}

export function shouldExcludeFromInvoiceCompletionQueue(candidate: InvoiceCompletionQueueCandidate): boolean {
  return isConfidentlyNotFinancialDocument(invoiceCandidateToFinancialInput(candidate));
}

export function filterInvoiceCompletionQueueCandidates<T extends InvoiceCompletionQueueCandidate>(
  candidates: T[]
): T[] {
  return candidates.filter((candidate) => !shouldExcludeFromInvoiceCompletionQueue(candidate));
}
