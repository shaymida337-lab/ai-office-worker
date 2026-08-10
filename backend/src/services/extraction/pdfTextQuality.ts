import type { PdfTextQualityAssessment, PdfTextQualityReasonCode, PdfTextQualityVerdict } from "./extractionTypes.js";

const MIN_USABLE_CHAR_COUNT = 24;
const MIN_PRINTABLE_RATIO = 0.72;
const MIN_ALPHANUMERIC_RATIO = 0.18;
const MAX_REPLACEMENT_CHAR_RATIO = 0.08;
const REPLACEMENT_CHAR_PATTERN = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Financial keyword hints — optional boost, never required for global acceptance. */
const FINANCIAL_KEYWORD_PATTERN =
  /\b(?:invoice|receipt|total|subtotal|vat|tax|amount|due|paid|balance|currency|usd|eur|gbp|ils|nis|חשבונית|קבלה|סה["״']?\s*כ|מע["״']?\s*מ|לתשלום|תאריך|supplier|bill\s*to|invoice\s*no|issue\s*date)\b/i;

function hasRepeatedJunk(text: string): boolean {
  return /\b(\d)(?:\s+\1){4,}\b/.test(text);
}

function countAlphanumeric(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) count += 1;
  }
  return count;
}

function countPrintable(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch === "\n" || ch === "\r" || ch === "\t" || (ch >= " " && ch <= "~") || /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch)) {
      count += 1;
    }
  }
  return count;
}

export function assessPdfTextQuality(text: string): PdfTextQualityAssessment {
  const trimmed = text.trim();
  const charCount = trimmed.length;

  if (charCount === 0) {
    return buildAssessment("garbled", "EMPTY", trimmed);
  }

  const printableRatio = countPrintable(trimmed) / charCount;
  const alphanumericRatio = countAlphanumeric(trimmed) / charCount;
  const replacementMatches = trimmed.match(REPLACEMENT_CHAR_PATTERN);
  const replacementRatio = (replacementMatches?.length ?? 0) / charCount;
  const hasFinancialKeywordEvidence = FINANCIAL_KEYWORD_PATTERN.test(trimmed);

  if (replacementRatio > MAX_REPLACEMENT_CHAR_RATIO) {
    return buildAssessment("garbled", "REPLACEMENT_CHARACTERS", trimmed, {
      printableRatio,
      alphanumericRatio,
      hasFinancialKeywordEvidence,
    });
  }

  if (charCount < MIN_USABLE_CHAR_COUNT) {
    return buildAssessment("insufficient", "TOO_SHORT", trimmed, {
      printableRatio,
      alphanumericRatio,
      hasFinancialKeywordEvidence,
    });
  }

  if (printableRatio < MIN_PRINTABLE_RATIO) {
    return buildAssessment("garbled", "LOW_PRINTABLE_RATIO", trimmed, {
      printableRatio,
      alphanumericRatio,
      hasFinancialKeywordEvidence,
    });
  }

  if (alphanumericRatio < MIN_ALPHANUMERIC_RATIO) {
    return buildAssessment("insufficient", "LOW_ALPHANUMERIC_RATIO", trimmed, {
      printableRatio,
      alphanumericRatio,
      hasFinancialKeywordEvidence,
    });
  }

  if (hasRepeatedJunk(trimmed)) {
    return buildAssessment("insufficient", "REPEATED_JUNK", trimmed, {
      printableRatio,
      alphanumericRatio,
      hasFinancialKeywordEvidence,
    });
  }

  if (!hasFinancialKeywordEvidence && alphanumericRatio < 0.35 && charCount < 80) {
    return buildAssessment("insufficient", "NO_FINANCIAL_EVIDENCE", trimmed, {
      printableRatio,
      alphanumericRatio,
      hasFinancialKeywordEvidence,
    });
  }

  return buildAssessment("usable", "USABLE", trimmed, {
    printableRatio,
    alphanumericRatio,
    hasFinancialKeywordEvidence,
  });
}

function buildAssessment(
  verdict: PdfTextQualityVerdict,
  reasonCode: PdfTextQualityReasonCode,
  text: string,
  partial?: Pick<PdfTextQualityAssessment, "printableRatio" | "alphanumericRatio" | "hasFinancialKeywordEvidence">
): PdfTextQualityAssessment {
  const charCount = text.trim().length;
  return {
    verdict,
    reasonCode,
    charCount,
    printableRatio: partial?.printableRatio ?? (charCount ? countPrintable(text) / charCount : 0),
    alphanumericRatio: partial?.alphanumericRatio ?? (charCount ? countAlphanumeric(text) / charCount : 0),
    hasFinancialKeywordEvidence: partial?.hasFinancialKeywordEvidence ?? FINANCIAL_KEYWORD_PATTERN.test(text),
  };
}

export function splitPdfTextIntoPages(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const byFormFeed = normalized.split("\f").map((page) => page.trim()).filter(Boolean);
  if (byFormFeed.length > 1) return byFormFeed;
  return [normalized];
}

export function formatPageMarkedText(pages: Array<{ pageIndex: number; text: string }>): string {
  return pages
    .filter((page) => page.text.trim())
    .map((page) => `--- PAGE ${page.pageIndex + 1} ---\n${page.text.trim()}`)
    .join("\n\n");
}
