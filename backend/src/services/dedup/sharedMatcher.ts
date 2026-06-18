import { createHash } from "crypto";

export type DedupMatchResult = "MATCH" | "NO_MATCH" | "UNSURE";

export type FinancialDocumentFingerprintInput = {
  organizationId?: string | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | string | null;
  documentDate?: Date | string | null;
  documentType?: string | null;
  fileSha256?: string | null;
};

export type MessageFingerprintInput = {
  organizationId?: string | null;
  channel?: string | null;
  providerMessageId?: string | null;
  sender?: string | null;
  body?: string | null;
  occurredAt?: Date | string | null;
};

export type FinancialDocumentMatch = {
  result: DedupMatchResult;
  reasons: string[];
  leftFingerprint: string;
  rightFingerprint: string;
};

export function normalizeSupplierName(value?: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:ltd|limited|inc|llc|corp|corporation|company|co)\b\.?/gi, " ")
    .replace(/\b(?:invoice|invoices|receipt|receipts|billing|payments?|accounts?|support|noreply|no.?reply)\b/gi, " ")
    .replace(/\b(?:בע\"מ|בע״מ|בעמ|חברה|חשבוניות|חשבונית|קבלה|תשלומים|גבייה)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function normalizeSupplierTaxId(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : "";
}

export function normalizeInvoiceNumber(value?: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?:invoice|receipt|inv|rcpt|חשבונית|קבלה|מספר|מס׳|no|number|#)/gi, "")
    .replace(/[^a-z0-9\u0590-\u05ff]+/gi, "")
    .replace(/^0+(?=\d)/, "")
    .trim();
}

export function normalizeAmount(value?: number | string | null) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = typeof value === "number"
    ? value
    : Number(String(value).replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return numeric.toFixed(2);
}

export function normalizeDocumentDate(value?: Date | string | null) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : parseLooseDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function normalizeDocumentType(value?: string | null) {
  const normalized = (value ?? "").toLowerCase();
  if (/tax_invoice_receipt|invoice_receipt|חשבונית\s*מס\s*קבלה/.test(normalized)) return "receipt";
  if (/receipt|קבלה/.test(normalized)) return "receipt";
  if (/payment_request|payment request|דרישת|בקשת/.test(normalized)) return "payment_request";
  if (/invoice|tax_invoice|חשבונית/.test(normalized)) return "invoice";
  return "document";
}

export function buildFinancialDocumentFingerprint(input: FinancialDocumentFingerprintInput) {
  const amount = normalizeAmount(input.totalAmount);
  const invoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
  const taxId = normalizeSupplierTaxId(input.supplierTaxId);
  const supplier = normalizeSupplierName(input.supplierName);
  const date = normalizeDocumentDate(input.documentDate);
  const documentType = normalizeDocumentType(input.documentType);
  const fileSha256 = (input.fileSha256 ?? "").trim().toLowerCase();
  const organizationId = (input.organizationId ?? "").trim().toLowerCase();

  if (fileSha256) {
    return hashParts(["financial-document", organizationId, "file", fileSha256]);
  }

  if (hasStrongInvoiceNumber(invoiceNumber) && amount) {
    return hashParts(["financial-document", organizationId, "invoice-amount", invoiceNumber, amount]);
  }

  if (taxId && hasStrongInvoiceNumber(invoiceNumber)) {
    return hashParts(["financial-document", organizationId, "tax-invoice", taxId, invoiceNumber]);
  }

  if (supplier && amount && date) {
    if (!hasStrongInvoiceNumber(invoiceNumber) && !fileSha256) {
      return hashParts(["financial-document", organizationId, "supplier-amount-date", supplier, amount, documentType]);
    }
    return hashParts(["financial-document", organizationId, "supplier-amount-date", supplier, amount, date, documentType]);
  }

  return hashParts(["financial-document", organizationId, "weak", supplier, invoiceNumber, amount, date, documentType]);
}

export function buildMessageFingerprint(input: MessageFingerprintInput) {
  const organizationId = (input.organizationId ?? "").trim().toLowerCase();
  const providerMessageId = (input.providerMessageId ?? "").trim().toLowerCase();
  if (providerMessageId) {
    return hashParts(["message", organizationId, "provider", providerMessageId]);
  }

  const sender = normalizeSupplierName(input.sender);
  const body = (input.body ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const occurredAt = normalizeMessageTime(input.occurredAt);
  return hashParts(["message", organizationId, "content", sender, body, occurredAt]);
}

export function matchFinancialDocuments(
  left: FinancialDocumentFingerprintInput,
  right: FinancialDocumentFingerprintInput
): FinancialDocumentMatch {
  const leftFingerprint = buildFinancialDocumentFingerprint(left);
  const rightFingerprint = buildFinancialDocumentFingerprint(right);
  const reasons: string[] = [];

  if (leftFingerprint === rightFingerprint && hasStrongFingerprintInput(left) && hasStrongFingerprintInput(right)) {
    reasons.push("fingerprint_match");
    return { result: "MATCH", reasons, leftFingerprint, rightFingerprint };
  }

  const leftNormalized = normalizedFinancialDocument(left);
  const rightNormalized = normalizedFinancialDocument(right);

  if (leftNormalized.fileSha256 && leftNormalized.fileSha256 === rightNormalized.fileSha256) {
    reasons.push("same_file_sha256");
    return { result: "MATCH", reasons, leftFingerprint, rightFingerprint };
  }

  if (leftNormalized.taxId && leftNormalized.taxId === rightNormalized.taxId && leftNormalized.invoiceNumber && leftNormalized.invoiceNumber === rightNormalized.invoiceNumber) {
    reasons.push("same_supplier_tax_id_and_invoice_number");
    return { result: "MATCH", reasons, leftFingerprint, rightFingerprint };
  }

  if (leftNormalized.invoiceNumber && leftNormalized.invoiceNumber === rightNormalized.invoiceNumber && leftNormalized.amount && leftNormalized.amount === rightNormalized.amount) {
    reasons.push("same_invoice_number_and_amount");
    return { result: "MATCH", reasons, leftFingerprint, rightFingerprint };
  }

  const sameSupplier = Boolean(leftNormalized.supplier && leftNormalized.supplier === rightNormalized.supplier);
  const sameAmount = Boolean(leftNormalized.amount && leftNormalized.amount === rightNormalized.amount);
  const sameDate = Boolean(leftNormalized.date && leftNormalized.date === rightNormalized.date);
  const sameInvoice = Boolean(leftNormalized.invoiceNumber && leftNormalized.invoiceNumber === rightNormalized.invoiceNumber);

  if ((sameSupplier && sameAmount && sameDate) || (sameInvoice && (sameSupplier || sameAmount || sameDate)) || (sameAmount && sameDate && (leftNormalized.supplier || rightNormalized.supplier))) {
    if (sameSupplier) reasons.push("same_supplier");
    if (sameAmount) reasons.push("same_amount");
    if (sameDate) reasons.push("same_date");
    if (sameInvoice) reasons.push("same_invoice_number");
    return { result: "UNSURE", reasons, leftFingerprint, rightFingerprint };
  }

  reasons.push("insufficient_overlap");
  return { result: "NO_MATCH", reasons, leftFingerprint, rightFingerprint };
}

function normalizedFinancialDocument(input: FinancialDocumentFingerprintInput) {
  return {
    supplier: normalizeSupplierName(input.supplierName),
    taxId: normalizeSupplierTaxId(input.supplierTaxId),
    invoiceNumber: normalizeInvoiceNumber(input.invoiceNumber),
    amount: normalizeAmount(input.totalAmount),
    date: normalizeDocumentDate(input.documentDate),
    fileSha256: (input.fileSha256 ?? "").trim().toLowerCase(),
  };
}

function hasStrongFingerprintInput(input: FinancialDocumentFingerprintInput) {
  const fileSha256 = (input.fileSha256 ?? "").trim();
  if (fileSha256) return true;
  const invoiceNumber = normalizeInvoiceNumber(input.invoiceNumber);
  const amount = normalizeAmount(input.totalAmount);
  if (hasStrongInvoiceNumber(invoiceNumber) && amount) return true;
  const taxId = normalizeSupplierTaxId(input.supplierTaxId);
  return Boolean(taxId && hasStrongInvoiceNumber(invoiceNumber));
}

function hasStrongInvoiceNumber(value: string) {
  return value.length >= 3 && /[\p{L}\d]/u.test(value);
}

function normalizeMessageTime(value?: Date | string | null) {
  const date = value instanceof Date ? value : value ? parseLooseDate(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  date.setSeconds(0, 0);
  return date.toISOString();
}

function parseLooseDate(value: string) {
  const trimmed = value.trim();
  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const fullYear = Number(year.length === 2 ? `20${year}` : year);
    return new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hashParts(parts: Array<string | number | null | undefined>) {
  const normalized = parts.map((part) => String(part ?? "").trim().toLowerCase()).join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 48);
}
