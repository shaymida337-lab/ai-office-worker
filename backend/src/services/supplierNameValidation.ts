const JUNK_CODE_CHARS = /[()[\]{}=;<>|\\`]|=>/;

const JUNK_ALWAYS_PATTERNS = /review amounts|rawOcrText/i;

const JUNK_COMPACT_PATTERNS =
  /firstString|parsed|FieldsFromText|detection|^null$|^undefined$|^nan$|\bnull\b|\bundefined\b|\bNaN\b/i;

const GLUED_PASCAL_CASE = /(?:[a-z\d][A-Z]){2,}/;

export function isLikelyJunkSupplierName(name: string): boolean {
  const cleaned = name.trim();
  if (!cleaned) return false;

  if (JUNK_CODE_CHARS.test(cleaned)) return true;

  const lower = cleaned.toLowerCase();
  if (JUNK_ALWAYS_PATTERNS.test(lower)) return true;

  if (!/\s/.test(cleaned)) {
    if (JUNK_COMPACT_PATTERNS.test(cleaned) || JUNK_COMPACT_PATTERNS.test(lower)) return true;
    if (GLUED_PASCAL_CASE.test(cleaned)) return true;
  }

  return false;
}
