/**
 * Canonical amount parser (single source of truth).
 * Ambiguous numeric forms return ambiguous=true — never silently inflate amounts.
 */

import { roundMoney } from "./parseAmountHelpers.js";

export type ParseAmountMethod =
  | "us_grouped_decimal"
  | "eu_grouped_decimal"
  | "plain_decimal"
  | "plain_integer"
  | "ambiguous_separator"
  | "invalid";

export type ParsedAmountResult = {
  raw: string;
  parsedAmount: number | null;
  parseMethod: ParseAmountMethod;
  ambiguous: boolean;
  warningReason: string | null;
};

export type ParseAmountOptions = {
  /** Set when match is adjacent to סה"כ לתשלום / Total Due / similar */
  stronglyLabeled?: boolean;
};

const MAX_PARSE_AMOUNT = 1_000_000;

function stripCurrencyAndSpace(raw: string) {
  return raw
    .replace(/[\u00a0&nbsp;]/gi, " ")
    .replace(/[₪$€]/g, "")
    .replace(/\b(?:ils|nis|usd|eur|ש["״']?ח|שקל|שקלים)\b/gi, "")
    .trim();
}

function digitsOnlyLength(segment: string) {
  return segment.replace(/[^\d]/g, "").length;
}

function isYearLikeInteger(value: number) {
  return Number.isInteger(value) && value >= 2020 && value <= 2030;
}

function isUsThousandsOnly(cleaned: string) {
  return /^\d{1,2},\d{3}$/.test(cleaned);
}

/**
 * Detect 3-digit trailing segment after sole separator — classic 110.723 / 110,723 / 11.800 trap.
 */
function hasAmbiguousTrailingSegment(cleaned: string) {
  if (isUsThousandsOnly(cleaned)) return false;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma === -1 && lastDot === -1) return false;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const fractional = cleaned.slice(cleaned.lastIndexOf(decimalSeparator) + 1);
    return fractional.length === 3;
  }

  const soleSep = lastComma !== -1 ? "," : ".";
  const idx = cleaned.lastIndexOf(soleSep);
  const decimals = cleaned.length - idx - 1;
  if (decimals === 3) return true;

  if (soleSep === "," && decimals !== 2) {
    const parts = cleaned.split(",");
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) return true;
  }

  if (soleSep === "." && decimals !== 1 && decimals !== 2) {
    const parts = cleaned.split(".");
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) return true;
  }

  return false;
}

export function parseAmount(raw: string, options: ParseAmountOptions = {}): ParsedAmountResult {
  const rawInput = raw.trim();
  const normalized = stripCurrencyAndSpace(rawInput);
  const cleaned = normalized.replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");

  if (!cleaned || !/\d/.test(cleaned)) {
    return {
      raw: rawInput,
      parsedAmount: null,
      parseMethod: "invalid",
      ambiguous: true,
      warningReason: "no_digits",
    };
  }

  const ambiguousSeparator = hasAmbiguousTrailingSegment(cleaned);

  if (ambiguousSeparator && !options.stronglyLabeled) {
    return {
      raw: rawInput,
      parsedAmount: null,
      parseMethod: "ambiguous_separator",
      ambiguous: true,
      warningReason: "ambiguous_thousands_or_decimal_separator",
    };
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let parseMethod: ParseAmountMethod = "plain_integer";
  let compact = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    compact = cleaned
      .replace(new RegExp(`\\${thousandsSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
    parseMethod = decimalSeparator === "," ? "eu_grouped_decimal" : "us_grouped_decimal";
  } else if (lastComma !== -1) {
    const decimals = cleaned.length - lastComma - 1;
    if (decimals === 2) {
      compact = cleaned.replace(",", ".");
      parseMethod = "plain_decimal";
    } else if (decimals === 3 && options.stronglyLabeled) {
      compact = cleaned.replace(/,/g, "");
      parseMethod = "us_grouped_decimal";
    } else if (options.stronglyLabeled) {
      compact = cleaned.replace(/,/g, "");
      parseMethod = "us_grouped_decimal";
    } else {
      return {
        raw: rawInput,
        parsedAmount: null,
        parseMethod: "ambiguous_separator",
        ambiguous: true,
        warningReason: "ambiguous_comma_format",
      };
    }
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1;
    if (decimals >= 1 && decimals <= 2) {
      compact = cleaned;
      parseMethod = "plain_decimal";
    } else if (decimals === 3 && options.stronglyLabeled) {
      compact = cleaned.replace(/\./g, "");
      parseMethod = "us_grouped_decimal";
    } else if (options.stronglyLabeled) {
      compact = cleaned.replace(/\./g, "");
      parseMethod = "us_grouped_decimal";
    } else {
      return {
        raw: rawInput,
        parsedAmount: null,
        parseMethod: "ambiguous_separator",
        ambiguous: true,
        warningReason: "ambiguous_dot_format",
      };
    }
  }

  compact = compact.replace(/\s/g, "");
  const amount = Number(compact);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      raw: rawInput,
      parsedAmount: null,
      parseMethod: "invalid",
      ambiguous: true,
      warningReason: "not_finite_or_non_positive",
    };
  }

  if (amount >= MAX_PARSE_AMOUNT) {
    return {
      raw: rawInput,
      parsedAmount: null,
      parseMethod: "invalid",
      ambiguous: true,
      warningReason: "exceeds_max_reasonable",
    };
  }

  const rounded = roundMoney(amount);
  const isAmbiguous = Boolean(
    ambiguousSeparator || (options.stronglyLabeled && hasAmbiguousTrailingSegment(cleaned))
  );

  return {
    raw: rawInput,
    parsedAmount: rounded,
    parseMethod,
    ambiguous: isAmbiguous,
    warningReason: isAmbiguous ? "ambiguous_thousands_or_decimal_separator" : null,
  };
}

/** Legacy-compatible: returns null for ambiguous/unparseable amounts. */
export function parseAmountOrNull(raw: string, options?: ParseAmountOptions): number | null {
  const result = parseAmount(raw, options);
  if (result.ambiguous || result.parsedAmount === null) return null;
  return result.parsedAmount;
}

export function parseLabeledAmount(raw: string): ParsedAmountResult {
  return parseAmount(raw, { stronglyLabeled: true });
}
