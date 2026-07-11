import { parseAmountGateFromParsedFields } from "./amountGate.js";
import { parseArcAmountSnapshot } from "./financeDisplayAmount.js";
import { isLikelyJunkSupplierName } from "../supplierNameValidation.js";

export const INVOICE_COMPLETION_REASON = {
  MISSING_AMOUNT: "חסר סכום",
  SUPPLIER_UNIDENTIFIED: "ספק לא זוהה",
  MISSING_DATE: "חסר תאריך",
  MISSING_CURRENCY: "מטבע חסר",
  MISSING_DOCUMENT_TYPE: "סוג מסמך חסר",
  MULTIPLE_AMOUNTS: "כמה סכומים נמצאו",
  LOW_CONFIDENCE: "רמת ביטחון נמוכה",
  USER_APPROVAL_REQUIRED: "נדרש אישור משתמש",
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
  confidenceScore?: string | number | null;
  decisionReason?: string | null;
  parsedFieldsJson?: unknown;
};

export type InvoiceCompletenessAssessment = {
  isComplete: boolean;
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

export function assessInvoiceCompleteness(input: InvoiceCompletenessInput): InvoiceCompletenessAssessment {
  const reasons: string[] = [];

  if (!hasValidSupplier(input.supplierName)) reasons.push(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED);
  if (!hasValidAmount(input.amount, input.amountResolved)) reasons.push(INVOICE_COMPLETION_REASON.MISSING_AMOUNT);
  if (!hasValidDocumentDate(input.date, input.documentDateExplicit)) reasons.push(INVOICE_COMPLETION_REASON.MISSING_DATE);
  if (!hasValidCurrency(input.currency, input.currencyExplicit)) reasons.push(INVOICE_COMPLETION_REASON.MISSING_CURRENCY);
  if (!hasRecognizedDocumentType(input.documentType)) reasons.push(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE);

  if (input.reviewStatus === "needs_review") {
    reasons.push(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED);
    if (hasMultipleAmountSignals(input)) reasons.push(INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS);
    if (hasLowConfidence(input.confidenceScore)) reasons.push(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE);
  }

  const requiredFieldsComplete =
    hasValidSupplier(input.supplierName) &&
    hasValidAmount(input.amount, input.amountResolved) &&
    hasValidDocumentDate(input.date, input.documentDateExplicit) &&
    hasValidCurrency(input.currency, input.currencyExplicit) &&
    hasRecognizedDocumentType(input.documentType);

  const isComplete = requiredFieldsComplete && input.reviewStatus === "approved";

  return {
    isComplete,
    completionReasons: [...new Set(reasons)],
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
