import type { SttCorrection } from "./sttAccuracyTypes.js";

const DIGIT_WORD_TO_CHAR: Record<string, string> = {
  אפס: "0",
  אחד: "1",
  אחת: "1",
  שתיים: "2",
  שניים: "2",
  שלוש: "3",
  שלושה: "3",
  ארבע: "4",
  ארבעה: "4",
  חמש: "5",
  חמישה: "5",
  שש: "6",
  שישה: "6",
  שבע: "7",
  שבעה: "7",
  שמונה: "8",
  תשע: "9",
  תשעה: "9",
};

const NUMBER_WORD_VALUES: Record<string, number> = {
  אחד: 1,
  אחת: 1,
  שתיים: 2,
  שניים: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
  עשרים: 20,
  שלושים: 30,
  ארבעים: 40,
  חמישים: 50,
  שישים: 60,
  שבעים: 70,
  שמונים: 80,
  תשעים: 90,
  מאה: 100,
  מאתיים: 200,
  "שלוש מאות": 300,
  "ארבע מאות": 400,
  "חמש מאות": 500,
  "שש מאות": 600,
  "שבע מאות": 700,
  "שמונה מאות": 800,
  "תשע מאות": 900,
  אלף: 1000,
  אלפיים: 2000,
  "שלושת אלפים": 3000,
  "ארבעת אלפים": 4000,
  "חמשת אלפים": 5000,
};

const DIGIT_WORD_PATTERN = Object.keys(DIGIT_WORD_TO_CHAR).join("|");
const PHONE_DIGIT_SEQUENCE = new RegExp(`(?:${DIGIT_WORD_PATTERN})(?:\\s+(?:ו)?(?:${DIGIT_WORD_PATTERN})){2,}`, "gu");

function normalizeNumberTokens(phrase: string): string[] {
  return phrase
    .split(/\s+/)
    .map((part) => part.replace(/^ו+/, "").trim())
    .filter(Boolean);
}

function parseHebrewCompoundNumber(tokens: string[]): number | null {
  let total = 0;
  let current = 0;

  for (const token of tokens) {
    const value = NUMBER_WORD_VALUES[token];
    if (value == null) return null;

    if (value === 1000 || value === 2000 || value >= 3000) {
      current = current === 0 ? value : current * value;
      total += current;
      current = 0;
      continue;
    }

    if (value === 100 || value === 200 || value >= 300) {
      current += value;
      continue;
    }

    if (value >= 20 && value <= 90) {
      current += value;
      continue;
    }

    current += value;
  }

  total += current;
  return total > 0 ? total : null;
}

function formatAmount(value: number): string {
  return value.toLocaleString("he-IL");
}

function normalizePhoneDigitSequences(text: string, corrections: SttCorrection[]): string {
  return text.replace(PHONE_DIGIT_SEQUENCE, (match) => {
    const tokens = match.split(/\s+/).map((part) => part.replace(/^ו/, ""));
    if (!tokens.every((token) => DIGIT_WORD_TO_CHAR[token])) return match;
    const digits = tokens.map((token) => DIGIT_WORD_TO_CHAR[token]).join("");
    if (digits.length < 3) return match;
    corrections.push({
      kind: "phone_digits",
      original: match,
      corrected: digits,
      confidence: 0.92,
      ambiguous: false,
    });
    return digits;
  });
}

function normalizeAmountPhrases(text: string, corrections: SttCorrection[]): string {
  const amountPattern =
    /((?:מאה|מאתיים|אלף|אלפיים|שלושת אלפים|ארבעת אלפים|חמשת אלפים|שלוש מאות|ארבע מאות|חמש מאות|שש מאות|שבע מאות|שמונה מאות|תשע מאות|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים|עשר|עשרה|אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה)(?:\s+ו?(?:מאה|מאתיים|אלף|אלפיים|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים|עשר|עשרה|אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה))+)\s+(שקל(?:ים)?|₪)/giu;

  return text.replace(amountPattern, (match, phrase: string, currency: string) => {
    const value = parseHebrewCompoundNumber(normalizeNumberTokens(phrase));
    if (value == null) return match;
    const corrected = `${formatAmount(value)} ${currency === "₪" ? "₪" : "₪"}`;
    corrections.push({
      kind: "hebrew_number",
      original: match.trim(),
      corrected,
      confidence: 0.9,
      ambiguous: false,
    });
    return corrected;
  });
}

function normalizeStandaloneCompoundNumbers(text: string, corrections: SttCorrection[]): string {
  const standalonePattern =
    /(?:^|[\s,.])(מאה|מאתיים|אלף|אלפיים|שלושת אלפים|ארבעת אלפים|חמשת אלפים)(?:\s+ו?(?:מאה|מאתיים|מאתיים|אלף|אלפיים|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים|עשר|עשרה|אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה)+)(?=$|[\s,.])/giu;

  return text.replace(standalonePattern, (match) => {
    const trimmed = match.trim();
    const value = parseHebrewCompoundNumber(normalizeNumberTokens(trimmed));
    if (value == null) return match;
    const corrected = formatAmount(value);
    corrections.push({
      kind: "hebrew_number",
      original: trimmed,
      corrected,
      confidence: 0.88,
      ambiguous: false,
    });
    return match.replace(trimmed, corrected);
  });
}

function normalizeDayOfMonthPhrases(text: string, corrections: SttCorrection[]): string {
  const dayPattern =
    /((?:שלושים|עשרים|עשר|עשרה|אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה)(?:\s+ו?(?:אחד|אחת|שתיים|שניים|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה))?)\s+לחודש/giu;

  return text.replace(dayPattern, (match, phrase: string) => {
    const value = parseHebrewCompoundNumber(normalizeNumberTokens(phrase));
    if (value == null || value < 1 || value > 31) return match;
    corrections.push({
      kind: "hebrew_number",
      original: phrase,
      corrected: String(value),
      confidence: 0.9,
      ambiguous: false,
    });
    return `${value} לחודש`;
  });
}

export function normalizeHebrewNumbersInTranscript(text: string): {
  text: string;
  corrections: SttCorrection[];
} {
  const corrections: SttCorrection[] = [];
  let normalized = text;
  normalized = normalizePhoneDigitSequences(normalized, corrections);
  normalized = normalizeAmountPhrases(normalized, corrections);
  normalized = normalizeDayOfMonthPhrases(normalized, corrections);
  normalized = normalizeStandaloneCompoundNumbers(normalized, corrections);
  return { text: normalized, corrections };
}
