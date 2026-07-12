import {
  isPaymentDocumentType,
  normalizeFinancialDocumentType,
} from "../financialDocuments.js";

export type ExtractedDocumentFinancialInput = {
  documentType?: string | null;
  supplierName?: string | null;
  totalAmount?: number | null;
  amount?: number | null;
  invoiceNumber?: string | null;
  ocrText?: string | null;
  pdfText?: string | null;
  attachmentText?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  ocrConfidence?: number | null;
  subject?: string | null;
  bodyText?: string | null;
};

const PLACEHOLDER_SUPPLIERS = new Set(["לא ידוע", "unknown"]);

const FINANCIAL_DOC_TITLE =
  /(?:חשבונית\s*מס(?:\s*\/\s*קבלה)?|tax\s+invoice|invoice\s+number|מספר\s*\(מקור\)\s*חשבונית)/i;
const FINANCIAL_TOTAL_DUE =
  /(?:סה"כ\s*לתשלום|total\s+due|amount\s+due|\bUSD\s+due\b|due\s+(?:June|May|January|February|March|April|July|August|September|October|November|December))/i;
const FINANCIAL_TAX_ID = /(?:עוסק\s*מורשה|ח\.פ\.?|עוסק\s*מאוחד|US\s+EIN|tax\s+id)/i;
const FINANCIAL_LINE_ITEMS = /(?:Qty|Unit\s+price|מחיר\s+יחידה|פריט\t|מע"מ\s*%)/i;
const LOGO_SUBJECT_HINT = /(?:לוקו|logo|מותג)/i;
const RETAIL_BRAND_LOGO_SUPPLIER = /^(?:max|am:pm|am\s*pm)/i;
const UTILITY_SERVICE_SUPPLIER =
  /(?:חברת\s*החשמל|מי[\s-]*רמת|בזק|פנגו|עיריית|ארנונה|כביש\s*6)/i;
const SERVICE_BILLING_TERM =
  /(?:חשבון|לתשלום|צריכה|מים|חשמל|ארנונה|תקופת\s*חיוב)/i;
const SERVICE_ACCOUNT_NUMBER =
  /(?:מספר\s*(?:חשבון|משלם|חוזה)|חשבון\s*(?:מס|מס')?\s*:?\s*[\d/ -]+)/i;
const SERVICE_BILLING_PERIOD =
  /(?:תקופת\s*חיוב|קריאת\s*מונה|מונה\s*קודם|מונה\s*נוכחי|תאריכי\s*חיוב)/i;
const SERVICE_DUE_DATE =
  /(?:תאריך\s*לתשלום|לתשלום\s*עד|מועד\s*תשלום|תשלום\s*עד)/i;
const SERVICE_AMOUNT_IN_TEXT =
  /(?:סכום\s*לתשלום|יתרה\s*לתשלום|סה"כ\s*לתשלום|לתשלום\s*:?\s*[\d,.]+)/i;
const NON_FINANCIAL_MESSAGE_CONTEXT =
  /(?:blocked\s+non-invoice\s+message|support\/test\s+email|render\s+notification|marketing|newsletter|unsubscribe|הודעת\s*מערכת|מייל\s*שיווקי)/i;
const INGESTION_REVIEW_BODY =
  /(?:Held\s+for\s+review|Quarantined:|cross-org\s+gmail\s+ingestion)/i;
const TECHNICAL_SUPPLIER_PATTERN = /(?:\/api\/|unknown\s+supplier|amount\s+0)/i;

function combinedText(input: ExtractedDocumentFinancialInput): string {
  return [
    input.subject,
    input.bodyText,
    input.ocrText,
    input.pdfText,
    input.attachmentText,
    input.filename,
    input.supplierName,
  ]
    .filter(Boolean)
    .join("\n");
}

function documentTextWithoutSupplier(input: ExtractedDocumentFinancialInput): string {
  return [
    input.subject,
    input.bodyText,
    input.ocrText,
    input.pdfText,
    input.attachmentText,
    input.filename,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function normalizedAmount(input: ExtractedDocumentFinancialInput): number | null {
  const value = input.totalAmount ?? input.amount ?? null;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function isUsableExtractedSupplierName(supplier?: string | null): boolean {
  const trimmed = (supplier ?? "").trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  return !PLACEHOLDER_SUPPLIERS.has(lowered) && !PLACEHOLDER_SUPPLIERS.has(trimmed);
}

function countFinancialStructureAnchors(text: string): number {
  let count = 0;
  if (FINANCIAL_DOC_TITLE.test(text)) count++;
  if (FINANCIAL_TOTAL_DUE.test(text)) count++;
  if (FINANCIAL_TAX_ID.test(text)) count++;
  if (FINANCIAL_LINE_ITEMS.test(text)) count++;
  if (/\b\d{5,}\b/.test(text) && /(?:invoice|חשבונית|קבלה|receipt)/i.test(text)) count++;
  return count;
}

function isImageAttachment(input: ExtractedDocumentFinancialInput): boolean {
  if (input.mimeType?.startsWith("image/")) return true;
  return /\.(jpe?g|png|heic|heif)$/i.test(input.filename ?? "");
}

function isLikelyRetailBrandLogo(input: ExtractedDocumentFinancialInput): boolean {
  const supplier = (input.supplierName ?? "").trim();
  if (RETAIL_BRAND_LOGO_SUPPLIER.test(supplier)) return true;
  if (LOGO_SUBJECT_HINT.test(combinedText(input))) return true;
  return false;
}

function isLogoOrBrandOnlyAttachment(input: ExtractedDocumentFinancialInput): boolean {
  if (!isImageAttachment(input)) return false;
  if (isLikelyRetailBrandLogo(input)) return true;

  const text = combinedText(input);
  const anchors = countFinancialStructureAnchors(text);
  const ocrConfidence = input.ocrConfidence ?? null;

  if (anchors >= 2) return false;
  if (isUsableExtractedSupplierName(input.supplierName) && UTILITY_SERVICE_SUPPLIER.test(text)) {
    return false;
  }
  if (isUsableExtractedSupplierName(input.supplierName) && !isLikelyRetailBrandLogo(input)) {
    return false;
  }

  if ((ocrConfidence ?? 1) <= 0.55 && !FINANCIAL_DOC_TITLE.test(text) && !FINANCIAL_TAX_ID.test(text)) {
    return true;
  }

  return anchors < 1;
}

function hasStrongExtractedPaymentSignals(input: ExtractedDocumentFinancialInput): boolean {
  const text = combinedText(input);
  const amount = normalizedAmount(input);
  const anchors = countFinancialStructureAnchors(text);

  if (amount != null && anchors >= 2) return true;
  if (amount != null && FINANCIAL_DOC_TITLE.test(text)) return true;
  if (anchors >= 3) return true;
  return false;
}

function isNonFinancialMessageContext(input: ExtractedDocumentFinancialInput): boolean {
  const text = combinedText(input);
  if (NON_FINANCIAL_MESSAGE_CONTEXT.test(text)) return true;
  if (TECHNICAL_SUPPLIER_PATTERN.test((input.supplierName ?? "").trim())) return true;

  const docText = documentTextWithoutSupplier(input);
  const emailOnly = (input.filename ?? "").trim() === "email-only";
  if (emailOnly && INGESTION_REVIEW_BODY.test(docText) && !SERVICE_BILLING_TERM.test(docText)) {
    return true;
  }
  return false;
}

function countServiceBillSignalTypes(input: ExtractedDocumentFinancialInput): number {
  const docText = documentTextWithoutSupplier(input);
  const supplierText = (input.supplierName ?? "").trim();
  const amount = normalizedAmount(input);
  const types = new Set<string>();

  if (SERVICE_BILLING_TERM.test(docText)) types.add("serviceTerm");
  if (SERVICE_ACCOUNT_NUMBER.test(docText)) types.add("accountNumber");
  if (SERVICE_BILLING_PERIOD.test(docText)) types.add("billingPeriod");
  if (SERVICE_DUE_DATE.test(docText)) types.add("dueDate");
  if (amount != null || SERVICE_AMOUNT_IN_TEXT.test(docText) || /₪/.test(docText)) {
    types.add("amountDue");
  }

  const supplierServiceTerm =
    UTILITY_SERVICE_SUPPLIER.test(supplierText) || SERVICE_BILLING_TERM.test(supplierText);
  if (supplierServiceTerm && types.size > 0) {
    types.add("serviceTerm");
  }

  return types.size;
}

function hasServiceBillFinancialStructure(input: ExtractedDocumentFinancialInput): boolean {
  if (isNonFinancialMessageContext(input)) return false;
  return countServiceBillSignalTypes(input) >= 2;
}

/**
 * Maps extracted document fields to financial / not-financial.
 * Imperfect documentType or missing optional fields must not reject a real invoice.
 * Brand/logo images must not be treated as invoices even when OCR invents amounts.
 */
export function resolveExtractedDocumentFinancial(input: ExtractedDocumentFinancialInput): boolean {
  if (isLogoOrBrandOnlyAttachment(input)) return false;
  if (isNonFinancialMessageContext(input)) return false;

  const normalizedType = normalizeFinancialDocumentType(input.documentType);
  if (isPaymentDocumentType(normalizedType)) return true;

  if (hasStrongExtractedPaymentSignals(input)) return true;
  if (hasServiceBillFinancialStructure(input)) return true;

  return false;
}

export function textFromParsedFieldsJson(parsedFieldsJson: unknown): string | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") return null;
  const record = parsedFieldsJson as Record<string, unknown>;
  const parts = [
    record.ocrText,
    record.pdfText,
    record.attachmentText,
    record.rawOcrText,
  ].filter((value) => typeof value === "string" && value.trim()) as string[];
  return parts.length ? parts.join("\n") : null;
}
