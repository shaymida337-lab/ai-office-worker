export type MoneyAmountParseResult = {
  amount: number | null;
  normalizedText: string | null;
  confidence: "high" | "medium" | "low";
  rejectedReason: string | null;
  warnings: string[];
};

export type MoneyAmountParseContext = {
  source?: "ocr" | "ai_json" | "manual";
  labelHint?: string;
  ocrRawText?: string;
};

const MAX_REASONABLE_AMOUNT = 1_000_000;
const MONEY_LABEL_PATTERN =
  /(?:סה["״']?כ\s*(?:לתשלום)?|סהכ\s*(?:לתשלום)?|סך\s*הכל\s*(?:לתשלום)?|(?:ה)?סכום\s*(?:לתשלום)?|יתרה\s*לתשלום|לתשלום|כולל\s*מע["״']?מ|total\s*(?:due|amount|inc(?:luding)?\s*vat)?|grand\s*total|amount\s*(?:due|paid)?|balance\s*due)/i;
const TOTAL_LABEL_PATTERN =
  /(?:סה["״']?כ\s*(?:לתשלום)?|סהכ\s*(?:לתשלום)?|סך\s*הכל\s*(?:לתשלום)?|(?:ה)?סכום\s*(?:לתשלום)?|יתרה\s*לתשלום|לתשלום|total\s*(?:due|amount)?|grand\s*total|amount\s*due|balance\s*due)/i;
const REFERENCE_NUMBER_CONTEXT =
  /(?:מס(?:פר|')?\s*(?:חשבונית|אסמכתא|הזמנה|לקוח|ספק|עוסק|חברה)?|חשבונית\s*מס|invoice\s*(?:no|number|#)|reference|ref\.?|order\s*(?:no|number|#)|customer\s*(?:no|number|#)|ח\.?פ\.?|עוסק\s*מורשה)/i;
const CURRENCY_PATTERN = /(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)/i;

type Candidate = {
  raw: string;
  index: number;
  length: number;
  score: number;
};

export function parseMoneyAmount(
  input: unknown,
  context: MoneyAmountParseContext = {}
): MoneyAmountParseResult {
  if (typeof input === "number") {
    return parseNumericInput(input, context);
  }

  if (typeof input === "string") {
    return parseTextInput(input, context);
  }

  return rejected("unsupported_input_type", null);
}

function parseNumericInput(value: number, context: MoneyAmountParseContext): MoneyAmountParseResult {
  if (!Number.isFinite(value)) return rejected("amount_not_finite", null);
  if (value <= 0) return rejected("amount_must_be_positive", String(value));

  const warnings: string[] = [];
  if (context.source === "ai_json" && context.ocrRawText) {
    const ocrResult = parseTextInput(context.ocrRawText, { ...context, source: "ocr", ocrRawText: undefined });
    if (ocrResult.amount !== null && materiallyDifferent(value, ocrResult.amount)) {
      return {
        ...ocrResult,
        confidence: lowerConfidence(ocrResult.confidence, "medium"),
        warnings: [
          ...ocrResult.warnings,
          `ai_numeric_amount_conflicts_with_ocr_raw_text: ai=${value} ocr=${ocrResult.amount}`,
        ],
      };
    }
  }

  const normalizedText = normalizeNumberText(value);
  const confidence = addMaxAmountWarning(value, warnings) ? "low" : "high";
  return {
    amount: value,
    normalizedText,
    confidence,
    rejectedReason: null,
    warnings,
  };
}

function parseTextInput(text: string, context: MoneyAmountParseContext): MoneyAmountParseResult {
  const normalized = normalizeText(text);
  const candidates = collectCandidates(normalized, context);
  const parsedCandidates = candidates
    .map((candidate) => ({ candidate, parsed: parseAmountToken(candidate.raw) }))
    .filter((entry) => entry.parsed.amount !== null);

  if (!parsedCandidates.length) {
    const negativeOrZero = parseAmountToken(normalized);
    if (negativeOrZero.rejectedReason) {
      return {
        amount: null,
        normalizedText: negativeOrZero.normalizedText,
        confidence: "low",
        rejectedReason: negativeOrZero.rejectedReason,
        warnings: negativeOrZero.warnings,
      };
    }
    return rejected("no_amount_found", null);
  }

  parsedCandidates.sort((a, b) => b.candidate.score - a.candidate.score || (b.parsed.amount ?? 0) - (a.parsed.amount ?? 0));
  const selected = parsedCandidates[0].parsed;
  const warnings = [...selected.warnings];
  const confidence = addMaxAmountWarning(selected.amount!, warnings)
    ? "low"
    : selected.confidence;

  return {
    amount: selected.amount,
    normalizedText: selected.normalizedText,
    confidence,
    rejectedReason: null,
    warnings,
  };
}

function collectCandidates(text: string, context: MoneyAmountParseContext): Candidate[] {
  const candidates: Candidate[] = [];
  const hintedText = context.labelHint ? `${context.labelHint} ${text}` : text;

  collectMatches(
    hintedText,
    /(?:סה["״']?כ\s*(?:לתשלום)?|סהכ\s*(?:לתשלום)?|סך\s*הכל\s*(?:לתשלום)?|(?:ה)?סכום\s*(?:לתשלום)?|יתרה\s*לתשלום|לתשלום|total\s*(?:due|amount)?|grand\s*total|amount\s*due|balance\s*due)[^\d₪$€+-]{0,80}(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)?\s*([-+]?[0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/gi,
    120,
    candidates,
    false
  );
  collectMatches(
    hintedText,
    /(?:subtotal|סכום\s*ביניים|לפני\s*מע["״']?מ|מע["״']?מ|vat)[^\d₪$€+-]{0,60}(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)?\s*([-+]?[0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/gi,
    60,
    candidates,
    false
  );
  collectMatches(
    hintedText,
    /(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)\s*([-+]?[0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/gi,
    80,
    candidates,
    true
  );
  collectMatches(
    hintedText,
    /([-+]?[0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)\s*(?:₪|ils|nis|ש["״']?ח|\$|usd|€|eur)/gi,
    80,
    candidates,
    true
  );
  collectMatches(
    hintedText,
    /([-+]?[0-9][0-9.,\s]*(?:[.,][0-9]{1,2})?)/g,
    10,
    candidates,
    true
  );

  return candidates;
}

function collectMatches(
  text: string,
  pattern: RegExp,
  score: number,
  out: Candidate[],
  requireReferenceCheck: boolean
) {
  for (const match of text.matchAll(pattern)) {
    const raw = match.slice(1).find((group) => group && /\d/.test(group));
    if (!raw) continue;
    const index = match.index ?? 0;
    const length = match[0].length;
    if (requireReferenceCheck && hasReferenceNumberContext(text, index, length)) {
      continue;
    }
    out.push({ raw, index, length, score });
  }
}

function parseAmountToken(raw: string): {
  amount: number | null;
  normalizedText: string | null;
  confidence: "high" | "medium" | "low";
  rejectedReason: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const cleaned = raw.replace(/[^\d.,+-]/g, "").replace(/[.,]+$/, "");
  if (!cleaned) return { amount: null, normalizedText: null, confidence: "low", rejectedReason: null, warnings };
  if (/^-/.test(cleaned)) {
    return { amount: null, normalizedText: cleaned, confidence: "low", rejectedReason: "amount_must_be_positive", warnings };
  }

  const unsigned = cleaned.replace(/^\+/, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : ".";
  let normalized = unsigned;
  let confidence: "high" | "medium" | "low" = "high";

  if (lastComma !== -1 && lastDot !== -1) {
    normalized = unsigned.replace(new RegExp(`\\${decimalSeparator === "," ? "." : ","}`, "g"), "").replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    const decimals = unsigned.length - lastComma - 1;
    const integerDigits = unsigned.slice(0, lastComma).replace(/\D/g, "").length;
    if (decimals === 2) {
      normalized = unsigned.replace(",", ".");
      if (integerDigits <= 2) {
        confidence = "low";
        warnings.push("suspicious_decimal_comma_two_digits_may_be_truncated_thousands");
      }
    } else {
      normalized = unsigned.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const decimals = unsigned.length - lastDot - 1;
    normalized = decimals === 2 ? unsigned : unsigned.replace(/\./g, "");
  }

  normalized = normalized.replace(/\s/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) {
    return { amount: null, normalizedText: normalized || null, confidence: "low", rejectedReason: "amount_not_finite", warnings };
  }
  if (amount <= 0) {
    return { amount: null, normalizedText: normalized, confidence: "low", rejectedReason: "amount_must_be_positive", warnings };
  }

  return {
    amount,
    normalizedText: normalized,
    confidence,
    rejectedReason: null,
    warnings,
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[״]/g, "\"");
}

function hasReferenceNumberContext(text: string, matchIndex: number, rawLength: number) {
  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(text.length, matchIndex + rawLength + 30);
  const context = text.slice(start, end);
  if (TOTAL_LABEL_PATTERN.test(context) || MONEY_LABEL_PATTERN.test(context) || CURRENCY_PATTERN.test(context)) {
    return false;
  }
  return REFERENCE_NUMBER_CONTEXT.test(context);
}

function materiallyDifferent(left: number, right: number) {
  return Math.abs(left - right) > 0.01;
}

function addMaxAmountWarning(amount: number, warnings: string[]) {
  if (amount <= MAX_REASONABLE_AMOUNT) return false;
  warnings.push(`amount_above_max_reasonable:${MAX_REASONABLE_AMOUNT}`);
  return true;
}

function lowerConfidence(current: "high" | "medium" | "low", max: "medium" | "low") {
  if (max === "low") return "low";
  return current === "high" ? "medium" : current;
}

function normalizeNumberText(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function rejected(rejectedReason: string, normalizedText: string | null): MoneyAmountParseResult {
  return {
    amount: null,
    normalizedText,
    confidence: "low",
    rejectedReason,
    warnings: [],
  };
}
