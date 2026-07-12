const JUNK_UNKNOWN_SUPPLIER_NAMES = new Set(
  ["unknown", "unknown supplier", "לא ידוע", "לא מזוהה", "n/a", "none", "ספק לא ידוע"].map((name) => name.toLowerCase())
);

const JUNK_TECHNICAL_SUBSTRINGS = [
  "firststring",
  "parsed",
  "fieldsfromtext",
  "detection",
  "paymentsuppliername",
  "suppliername",
  "rawocr",
  "null",
  "undefined",
  "nan",
];

const JUNK_SINGLE_WORD_TECHNICAL = new Set([
  "current",
  "supplier",
  "address",
  "name",
  "value",
  "text",
  "field",
  "output",
  "ocr",
  "ai",
  "input",
  // מילים גנריות שדלפו כ"ספק" (מסונכרן עם GENERIC_STANDALONE_NAMES בבקאנד)
  "invoice",
  "invoices",
  "receipt",
  "receipts",
  "document",
  "documents",
  "payment",
  "file",
  "files",
  "scan",
  "scans",
  "image",
  "images",
  "attachment",
  "attachments",
  "temp",
  "test",
  "data",
  "folder",
  "upload",
  "uploads",
]);

const JUNK_CONTAINS_PHRASES = [
  "ocr/ai",
  "ocr / ai",
  "ai output",
  "ocr output",
  "raw ocr",
  "rawocr",
];

function normalizeJunkSupplierName(name: string): string {
  return name.trim().replace(/^[\s.,:;]+|[\s.,:;]+$/g, "");
}

export function isLikelyJunkSupplierNameLocal(name: string): boolean {
  const cleaned = normalizeJunkSupplierName(name);
  if (!cleaned) return false;

  const lower = cleaned.toLowerCase();

  if (JUNK_UNKNOWN_SUPPLIER_NAMES.has(lower)) return true;
  if (cleaned.length > 60) return true;
  if (/^\d+\.\s/.test(cleaned)) return true;
  if (JUNK_CONTAINS_PHRASES.some((phrase) => lower.includes(phrase))) return true;
  if (/[()[\]{}=;<>`]/.test(cleaned)) return true;
  if (JUNK_SINGLE_WORD_TECHNICAL.has(lower)) return true;

  if (!/\s/.test(cleaned)) {
    if (JUNK_TECHNICAL_SUBSTRINGS.some((token) => lower.includes(token))) return true;
    if (cleaned.length > 12 && /[a-z][A-Z]/.test(cleaned)) return true;
  }

  return false;
}

export function isJunkPayment(payment: { supplier: string; amount: number; date: string }) {
  const supplier = payment.supplier?.trim() ?? "";
  if (supplier && isLikelyJunkSupplierNameLocal(supplier)) return true;
  if (payment.amount === 1_000_000 || payment.amount === 0) return true;
  const parsedDate = new Date(payment.date);
  if (!Number.isNaN(parsedDate.getTime()) && parsedDate.getFullYear() > new Date().getFullYear() + 1) return true;
  return false;
}
