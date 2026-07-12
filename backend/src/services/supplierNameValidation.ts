const JUNK_CODE_CHARS = /[()[\]{}=;<>|\\`]|=>/;

const JUNK_ALWAYS_PATTERNS = /review amounts|rawOcrText/i;

const JUNK_COMPACT_PATTERNS =
  /firstString|parsed|FieldsFromText|detection|^null$|^undefined$|^nan$|\bnull\b|\bundefined\b|\bNaN\b/i;

const GLUED_PASCAL_CASE = /(?:[a-z\d][A-Z]){2,}/;

const MAX_SUPPLIER_NAME_LENGTH = 60;

// שברי JSON/סכימה שדולפים מתשובות מודל: `"supplier": "..."`, פתיחת אובייקט/מערך.
const JUNK_JSON_FRAGMENT = /^["'{[]|["']\s*:\s*|\bjson\b/i;

const UNKNOWN_SUPPLIER_NAMES = new Set(
  [
    "unknown",
    "unknown supplier",
    "unknown vendor",
    "לא ידוע",
    "לא מזוהה",
    "לא זוהה",
    "לא צוין",
    "לא צויין",
    "לא נמצא",
    "אין",
    "חסר",
    "n/a",
    "none",
    "not specified",
    "not found",
    "not available",
    "no supplier",
    "missing",
    "tbd",
    "todo",
    "example",
    "placeholder",
    "-",
    "--",
    "—",
  ].map((name) => name.toLowerCase())
);

// מילים גנריות שמופיעות לבד כ"ספק" כשהחילוץ נכשל (התאמה מדויקת בלבד —
// "חברת החשמל" או "ספק המים הארצי" לא נחסמים).
const GENERIC_STANDALONE_NAMES = new Set(
  [
    "ספק",
    "חברה",
    "עסק",
    "לקוח",
    "מוכר",
    "שם",
    "שם הספק",
    "שם העסק",
    "שם החברה",
    "חשבונית",
    "חשבונית מס",
    "קבלה",
    "מסמך",
    "תשלום",
    "כללי",
    "supplier",
    "vendor",
    "company",
    "business",
    "supplier name",
    "business name",
    "company name",
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
  ].map((name) => name.toLowerCase())
);

// דליפות הוראות/פרומפט — גבולות מילה כדי לא לחסום ספקים לגיטימיים
// ("Data Supplier Ltd" מכיל את הרצף "a supplier" אבל לא את המילה "a").
const INSTRUCTION_LEAK_PATTERNS: RegExp[] = [
  /\binside each\b/i,
  /\ba supplier\b/i,
  /\bthe business pays\b/i,
  /\bfor example\b/i,
  /\be\.g\./i,
  /\bexpense the business\b/i,
  /\bdoes it\b/i,
  /rawocr/i,
  /\bsuppliername\b/i,
  /\bextract\b/i,
  /\bextracted from\b/i,
];

const NUMBERED_LIST_PREFIX = /^\d+\.\s/;

// זיהוי "שם" שהוא בעצם קטע משפט שנתפס ברגקס (למשל שורת נושא/גוף מייל):
// שתי מילות-קישור ומעלה, או יותר מ-8 מילים.
// שמות ארוכים לגיטימיים ("החברה הישראלית לביטוח סיכוני סחר חוץ בע"מ") עוברים.
const SENTENCE_STOPWORDS = new Set(
  [
    "שלך",
    "שלכם",
    "שלנו",
    "בנושא",
    "מצורף",
    "מצורפת",
    "מצורפים",
    "אנא",
    "נא",
    "כדי",
    "אשר",
    "תודה",
    "שלום",
    "בברכה",
    "your",
    "please",
    "attached",
    "regarding",
    "thanks",
    "hello",
    "dear",
    "this",
    "here",
  ].map((w) => w.toLowerCase())
);
const MAX_SUPPLIER_NAME_WORDS = 8;

export function looksLikeSentenceFragmentName(name: string): boolean {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length > MAX_SUPPLIER_NAME_WORDS) return true;
  const stopwordHits = words.filter((w) => SENTENCE_STOPWORDS.has(w)).length;
  return stopwordHits >= 2;
}

/**
 * כלל חיובי (allowlist-like): מילה אנגלית בודדת בלי שום הקשר עסקי —
 * בלי Ltd/Inc/בע"מ, בלי ח.פ, בלי דומיין, בלי ספרות, בלי עברית —
 * היא חשודה כברירת מחדל. blocklist תמיד יפספס את המילה הבאה ("files",
 * "misc", "stuff"); הכלל הזה הופך את ברירת המחדל לחשד במקום אישור.
 * (מילה בודדת מטבעה לא יכולה לשאת הקשר עסקי כמו Ltd או ח.פ — לכן די
 * בבדיקת הצורה: טוקן אחד, אותיות אנגליות בלבד.)
 *
 * חריג: אותיות-פנימיות-גדולות בסגנון מותג ("PayPal", "iCount", "GoDaddy")
 * נחשבות הקשר עסקי — אלה שמות מסחריים, לא מילים גנריות.
 *
 * הצרכן (supplierGate) מחיל את הכלל רק כשהראיה היחידה היא חילוץ AI —
 * ספק שמוכר מהיסטוריית הארגון / רשום עם ח.פ / מתויג במסמך עובר כרגיל.
 */
export function isGenericSingleEnglishWordName(name: string): boolean {
  const cleaned = name.trim();
  if (!cleaned || /\s/.test(cleaned)) return false;
  if (!/^[A-Za-z]+$/.test(cleaned)) return false;
  if (/[a-z][A-Z]/.test(cleaned)) return false;
  return true;
}

export function isLikelyJunkSupplierName(name: string): boolean {
  const cleaned = name.trim();
  if (!cleaned) return false;

  const lower = cleaned.toLowerCase();
  if (UNKNOWN_SUPPLIER_NAMES.has(lower)) return true;
  if (GENERIC_STANDALONE_NAMES.has(lower)) return true;

  if (cleaned.length > MAX_SUPPLIER_NAME_LENGTH) return true;

  if (NUMBERED_LIST_PREFIX.test(cleaned)) return true;

  if (INSTRUCTION_LEAK_PATTERNS.some((pattern) => pattern.test(cleaned))) return true;

  if (JUNK_CODE_CHARS.test(cleaned)) return true;

  if (JUNK_JSON_FRAGMENT.test(cleaned)) return true;

  if (JUNK_ALWAYS_PATTERNS.test(lower)) return true;

  if (looksLikeSentenceFragmentName(cleaned)) return true;

  if (!/\s/.test(cleaned)) {
    if (JUNK_COMPACT_PATTERNS.test(cleaned) || JUNK_COMPACT_PATTERNS.test(lower)) return true;
    if (GLUED_PASCAL_CASE.test(cleaned)) return true;
  }

  return false;
}
