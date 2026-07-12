import { parseAmountGateFromParsedFields } from "./amountGate.js";
import { parseArcAmountSnapshot } from "./financeDisplayAmount.js";
import { isLikelyJunkSupplierName } from "../supplierNameValidation.js";
import {
  isConfidentlyNotFinancialDocument,
  textFromParsedFieldsJson,
  type ExtractedDocumentFinancialInput,
} from "../classification/financialDocumentClassification.js";

export const INVOICE_COMPLETION_REASON = {
  MISSING_AMOUNT: "חסר סכום",
  SUPPLIER_UNIDENTIFIED: "ספק לא זוהה",
  MISSING_DATE: "חסר תאריך",
  MISSING_CURRENCY: "מטבע חסר",
  MISSING_DOCUMENT_TYPE: "סוג מסמך חסר",
  MULTIPLE_AMOUNTS: "כמה סכומים נמצאו",
  LOW_CONFIDENCE: "רמת ביטחון נמוכה",
  USER_APPROVAL_REQUIRED: "ממתין לאישור",
} as const;

const RECOGNIZED_DOCUMENT_TYPES = new Set([
  "invoice",
  "receipt",
  "tax_invoice",
  "tax_invoice_receipt",
  "payment_request",
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
};

export type InvoiceCompletenessAssessment = {
  dataComplete: boolean;
  approvalRequired: boolean;
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

function hasMultipleAmountSignals(input: InvoiceCompletenessInput): boolean {
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

  if (!hasValidSupplier(input.supplierName)) missingDataReasons.push(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED);
  if (!hasValidAmount(input.amount, input.amountResolved)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_AMOUNT);
  if (!hasValidDocumentDate(input.date, input.documentDateExplicit)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_DATE);
  if (!hasValidCurrency(input.currency, input.currencyExplicit)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_CURRENCY);
  if (!hasRecognizedDocumentType(input.documentType)) missingDataReasons.push(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE);

  const rawStatus = input.rawReviewStatus ?? input.reviewStatus;
  const approvalRequired = !isInvoiceRecordApproved(rawStatus) && rawStatus !== "rejected";

  if (approvalRequired) {
    approvalReasons.push(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED);
    if (hasMultipleAmountSignals(input)) approvalReasons.push(INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS);
    if (hasLowConfidence(input.confidenceScore)) approvalReasons.push(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE);
  }

  const dataComplete = missingDataReasons.length === 0;
  const isComplete = dataComplete && !approvalRequired;

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
