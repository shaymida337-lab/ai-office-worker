const JUNK_CODE_CHARS = /[()[\]{}=;<>|\\`]|=>/;

const JUNK_ALWAYS_PATTERNS = /review amounts|rawOcrText/i;

const JUNK_COMPACT_PATTERNS =
  /firstString|parsed|FieldsFromText|detection|^null$|^undefined$|^nan$|\bnull\b|\bundefined\b|\bNaN\b/i;

const GLUED_PASCAL_CASE = /(?:[a-z\d][A-Z]){2,}/;

const MAX_SUPPLIER_NAME_LENGTH = 60;

const UNKNOWN_SUPPLIER_NAMES = new Set(
  [
    "unknown",
    "unknown supplier",
    "לא ידוע",
    "לא מזוהה",
    "n/a",
    "none",
    "ספק לא ידוע",
  ].map((name) => name.toLowerCase())
);

const INSTRUCTION_LEAK_PATTERNS = [
  "inside each",
  "a supplier",
  "the business pays",
  "for example",
  "e.g.",
  "expense the business",
  "does it",
  "rawocr",
  "suppliername",
  "extract",
] as const;

const NUMBERED_LIST_PREFIX = /^\d+\.\s/;

export function isLikelyJunkSupplierName(name: string): boolean {
  const cleaned = name.trim();
  if (!cleaned) return false;

  const lower = cleaned.toLowerCase();
  if (UNKNOWN_SUPPLIER_NAMES.has(lower)) return true;

  if (cleaned.length > MAX_SUPPLIER_NAME_LENGTH) return true;

  if (NUMBERED_LIST_PREFIX.test(cleaned)) return true;

  if (INSTRUCTION_LEAK_PATTERNS.some((pattern) => lower.includes(pattern))) return true;

  if (JUNK_CODE_CHARS.test(cleaned)) return true;

  if (JUNK_ALWAYS_PATTERNS.test(lower)) return true;

  if (!/\s/.test(cleaned)) {
    if (JUNK_COMPACT_PATTERNS.test(cleaned) || JUNK_COMPACT_PATTERNS.test(lower)) return true;
    if (GLUED_PASCAL_CASE.test(cleaned)) return true;
  }

  return false;
}
