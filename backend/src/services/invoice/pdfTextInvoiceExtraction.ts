import { parseLabeledAmount } from "../amount/parseAmount.js";
import { isLikelyJunkSupplierName } from "../supplierNameValidation.js";

export type PdfTextDeterministicInvoiceFields = {
  supplierName: string | null;
  totalAmount: number | null;
  documentDate: string | null;
  documentType: "invoice" | "tax_invoice_receipt" | "receipt" | "payment_request" | "quote" | "other" | null;
  currency: string | null;
};

const PDF_ATTACHMENT_MARKERS = ["--- PDF ATTACHMENT TEXT ---", "--- WHATSAPP PDF TEXT ---"];

const PRE_VAT_AMOUNT_CONTEXT =
  /(?:לפני\s*מע["״']?\s*מ|לפני\s*מע"מ|before\s*vat|subtotal|net\s*amount|excl(?:uding)?\s*vat)/i;

const TOTAL_AMOUNT_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  {
    pattern:
      /(?:₪|ils|nis|ש["״']?ח)\s*([0-9][0-9.,\s]*)\s*(?:סה["״']?\s*כ\s*לתשלום|סהכ\s*לתשלום)/gi,
    score: 120,
  },
  {
    pattern:
      /(?:סה["״']?\s*כ\s*לתשלום|סהכ\s*לתשלום)[^\d₪$€]{0,40}(?:₪|ils|nis|ש["״']?ח)?\s*([0-9][0-9.,\s]*)/gi,
    score: 110,
  },
  {
    pattern:
      /(?:סה["״']?\s*כ\s*כולל\s*מע["״']?\s*מ|סהכ\s*כולל\s*מע"מ)[^\d₪$€]{0,40}(?:₪|ils|nis|ש["״']?ח)?\s*([0-9][0-9.,\s]*)/gi,
    score: 100,
  },
  {
    pattern:
      /(?:total\s*(?:due|amount)|amount\s*due|balance\s*due)[^\d$€]{0,30}\$?\s*([0-9][0-9.,\s]*)/gi,
    score: 100,
  },
  {
    pattern: /(?:₪|ils|nis|ש["״']?ח)\s*([0-9][0-9.,\s]*)\s*(?:סה["״']?\s*כ(?!.*לפני))/gi,
    score: 60,
  },
  {
    pattern: /(?:סה["״']?\s*כ(?!.*לפני)|סהכ(?!.*לפני))[^\d₪$€]{0,20}(?:₪|ils|nis|ש["״']?ח)?\s*([0-9][0-9.,\s]*)/gi,
    score: 50,
  },
];

const DOCUMENT_DATE_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  {
    pattern: /(?:הופק\s*ב|date\s*of\s*issue|issued\s*on|issue\s*date)[^\d]{0,20}(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/gi,
    score: 120,
  },
  {
    pattern:
      /(?:הופק\s*ב|date\s*of\s*issue|issued\s*on|issue\s*date)[^\d]{0,20}(\d{4})[./-](\d{1,2})[./-](\d{1,2})/gi,
    score: 120,
  },
  {
    pattern: /(?:תאריך\s*חשבונית|invoice\s*date|document\s*date)[^\d]{0,20}(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/gi,
    score: 100,
  },
  {
    pattern: /(?:תאריך\s*חשבונית|invoice\s*date|document\s*date)[^\d]{0,20}(\d{4})[./-](\d{1,2})[./-](\d{1,2})/gi,
    score: 100,
  },
  {
    pattern: /(?:מקור\s*חשבונית[^\n]{0,40}\n)(\d{1,2})[./-](\d{1,2})[./-](\d{4})/gi,
    score: 90,
  },
];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeIsoDate(day: string, month: string, yearRaw: string): string | null {
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  const dd = day.padStart(2, "0");
  const mm = month.padStart(2, "0");
  if (!/^\d{4}$/.test(year) || Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) {
    return null;
  }
  return `${year}-${mm}-${dd}`;
}

export function extractPdfAttachmentText(body: string): string | null {
  for (const marker of PDF_ATTACHMENT_MARKERS) {
    const idx = body.indexOf(marker);
    if (idx === -1) continue;
    let after = body.slice(idx + marker.length).replace(/^\s*\n?/, "");
    const nextSection = after.search(/\n--- [A-Z]/);
    if (nextSection !== -1) after = after.slice(0, nextSection);
    const trimmed = after.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function parseAmountCandidate(raw: string, score: number, text: string, matchIndex: number) {
  const contextStart = Math.max(0, matchIndex - 40);
  const contextEnd = Math.min(text.length, matchIndex + raw.length + 40);
  const context = text.slice(contextStart, contextEnd);
  if (PRE_VAT_AMOUNT_CONTEXT.test(context)) return null;

  const parsed = parseLabeledAmount(raw);
  if (parsed.ambiguous || parsed.parsedAmount === null) return null;
  return { amount: parsed.parsedAmount, score };
}

function extractTotalAmountFromPdfText(text: string): number | null {
  const candidates: Array<{ amount: number; score: number }> = [];

  for (const { pattern, score } of TOTAL_AMOUNT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const raw = match.slice(1).find((group) => group && /\d/.test(group));
      if (!raw) continue;
      const parsed = parseAmountCandidate(raw, score, text, match.index ?? 0);
      if (parsed) candidates.push(parsed);
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return candidates[0].amount;
}

function extractDocumentDateFromPdfText(text: string): string | null {
  const candidates: Array<{ date: string; score: number }> = [];

  for (const { pattern, score } of DOCUMENT_DATE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      let iso: string | null = null;
      if (match[1] && match[1].length === 4) {
        iso = normalizeIsoDate(match[3], match[2], match[1]);
      } else if (match[1] && match[2] && match[3]) {
        iso = normalizeIsoDate(match[1], match[2], match[3]);
      }
      if (iso) candidates.push({ date: iso, score });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].date;
}

function extractDocumentTypeFromPdfText(text: string): PdfTextDeterministicInvoiceFields["documentType"] {
  const normalized = text.replace(/\s+/g, " ");
  if (/חשבונית\s*מס\s*\/\s*קבלה|חשבונית\s*מס\s*קבלה|tax\s+invoice\s*\/\s*receipt/i.test(normalized)) {
    return "tax_invoice_receipt";
  }
  if (/quote|proposal|estimate|הצעת\s*מחיר/i.test(normalized)) return "quote";
  if (/payment\s*request|דרישת\s*תשלום|בקשת\s*תשלום/i.test(normalized)) return "payment_request";
  if (/חשבונית\s*עסקה|proforma/i.test(normalized)) return "invoice";
  if (/(?:^|\n)\s*invoice(?:\s+number|\s*$)/im.test(text) || /חשבונית\s*מס(?!.*קבלה)/i.test(normalized)) {
    return "invoice";
  }
  if (/(?:^|\n)\s*receipt\b/im.test(text) || /(?:^|\n)\s*קבלה\b/im.test(text)) return "receipt";
  return null;
}

function isHighConfidenceSupplierLine(line: string): boolean {
  const cleaned = normalizeWhitespace(line);
  if (cleaned.length < 2 || cleaned.length > 80) return false;
  if (/^(לכבוד|bill\s+to|עוסק|ח\.?פ|ת\.?ז|ai-|support@|page\s+\d|invoice\s+number|date\s+of)/i.test(cleaned)) {
    return false;
  }
  if (/^date\s+(due|of\s+issue)\b/i.test(cleaned)) return false;
  if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(cleaned)) {
    return false;
  }
  if (/\bdate\s+(due|of\s+issue)\b/i.test(cleaned)) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(cleaned)) return false;
  if (/^[₪$€\d.,\s|]+$/.test(cleaned)) return false;
  if (isLikelyJunkSupplierName(cleaned)) return false;
  return /[\p{L}]/u.test(cleaned);
}

function cleanSupplierCandidate(value: string): string | null {
  const cleaned = normalizeWhitespace(value.replace(/\|.*$/g, "").replace(/\(.*$/g, "").trim());
  if (!isHighConfidenceSupplierLine(cleaned)) return null;
  return cleaned;
}

function extractSupplierNameFromPdfText(text: string): string | null {
  const labeled = text.match(
    /(?:שם\s*(?:ה)?(?:ספק|עסק|מנפיק)|supplier(?:\s*name)?|issued\s+by|from)[:\s-]+([^\n|]{2,80})/i
  );
  if (labeled?.[1]) {
    const candidate = cleanSupplierCandidate(labeled[1]);
    if (candidate) return candidate;
  }

  const lines = text.split(/\n+/).map((line) => normalizeWhitespace(line)).filter(Boolean);
  const hasHebrew = /[\u0590-\u05FF]/.test(text);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!hasHebrew || !/חשבונית\s*מס|tax\s+invoice|^invoice$/i.test(line)) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const candidate = cleanSupplierCandidate(lines[j]);
      if (candidate) return candidate;
    }
  }

  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    if (!/חשבונית\s*מס|עמוד\s*1|invoice/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const candidate = cleanSupplierCandidate(lines[j]);
      if (candidate) return candidate;
    }
  }

  return null;
}

function extractCurrencyFromPdfText(text: string, totalAmount: number | null): string | null {
  const normalized = text.toLowerCase();
  if (/₪|\bils\b|\bnis\b|ש["״']?ח/.test(normalized)) return "ILS";
  if (/\busd\b|\$/.test(normalized)) return "USD";
  if (/\beur\b|€/.test(normalized)) return "EUR";

  if (totalAmount !== null && /₪/.test(text)) return "ILS";
  return null;
}

export function extractDeterministicInvoiceFieldsFromPdfText(
  pdfText: string
): PdfTextDeterministicInvoiceFields {
  const text = pdfText.replace(/\u0000/g, "").trim();
  if (!text) {
    return {
      supplierName: null,
      totalAmount: null,
      documentDate: null,
      documentType: null,
      currency: null,
    };
  }

  const totalAmount = extractTotalAmountFromPdfText(text);
  return {
    supplierName: extractSupplierNameFromPdfText(text),
    totalAmount,
    documentDate: extractDocumentDateFromPdfText(text),
    documentType: extractDocumentTypeFromPdfText(text),
    currency: extractCurrencyFromPdfText(text, totalAmount),
  };
}

export function extractDeterministicInvoiceFieldsFromEmailBody(
  body: string
): PdfTextDeterministicInvoiceFields | null {
  const pdfText = extractPdfAttachmentText(body);
  if (!pdfText) return null;
  return extractDeterministicInvoiceFieldsFromPdfText(pdfText);
}

type MergeableEmailAnalysis = {
  supplier: string;
  amount: number | null;
  totalAmount: number | null;
  currency: string;
  documentType: "invoice" | "tax_invoice_receipt" | "receipt" | "payment_request" | "quote" | "other";
  invoiceDate: string | null;
};

export function mergePdfTextDeterministicFields<T extends MergeableEmailAnalysis>(
  analysis: T,
  deterministic: PdfTextDeterministicInvoiceFields | null
): T {
  if (!deterministic) return analysis;

  const merged = { ...analysis };
  if (deterministic.supplierName) merged.supplier = deterministic.supplierName;
  if (deterministic.totalAmount !== null) {
    merged.totalAmount = deterministic.totalAmount;
    merged.amount = deterministic.totalAmount;
  }
  if (deterministic.documentDate) merged.invoiceDate = deterministic.documentDate;
  if (deterministic.documentType) merged.documentType = deterministic.documentType;
  if (deterministic.currency) merged.currency = deterministic.currency;
  return merged;
}
