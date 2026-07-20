/**
 * Customer-facing Natalie response layer — strips internal/technical wording
 * and polishes phrasing before text reaches chat, voice, WhatsApp, or API.
 * Display-only; does not change tools, routing, or business logic.
 */

export const NATALIE_CUSTOMER_EMPTY = "לא מצאתי את זה אצלי כרגע.";

/** Must never appear in user-visible Natalie output. */
export const FORBIDDEN_CUSTOMER_OUTPUT_STRINGS = [
  "Google Calendar",
  "Gmail",
  "CRM",
  "Source",
  "מקור נתונים",
  "API",
  "Database",
  "Cache",
  "Tool",
  "Provider",
  "Model",
  "JSON",
  "Prompt",
] as const;

const STRIP_LINE_PATTERNS: RegExp[] = [
  /^מקור נתונים\s*:[^.]*\.\s*$/i,
  /^source\s*:[^.]*\.\s*$/i,
  /^\s*מקור\s*:[^.]*\.\s*$/i,
  /^provider\s*:[^.]*\.\s*$/i,
  /^model\s*:[^.]*\.\s*$/i,
  /^tool\s*:[^.]*\.\s*$/i,
  /^json\s*:[^.]*\.\s*$/i,
  /^prompt\s*:[^.]*\.\s*$/i,
  /^api\s*:[^.]*\.\s*$/i,
  /^database\s*:[^.]*\.\s*$/i,
  /^cache\s*:[^.]*\.\s*$/i,
  /^sync\s*:[^.]*\.\s*$/i,
];

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/Google Calendar timeout/gi, "לא הצלחתי לבדוק את היומן כרגע"],
  [/Google Calendar synchronized successfully/gi, ""],
  [/Request completed/gi, ""],
  [/synchronized successfully/gi, ""],
  [/Google Calendar/gi, "היומן"],
  [/google calendar/gi, "היומן"],
  [/ב-Google\b/gi, ""],
  [/מ[-־]?Gmail\b/gi, ""],
  [/ב[-־]?Gmail\b/gi, ""],
  [/\s*מהמייל\./gi, "."],
  [/\s*מהמייל/gi, ""],
  [/\s*במייל\./gi, "."],
  [/\s*במייל/gi, ""],
  [/\s*מהמיילים\./gi, "."],
  [/\s*מהמיילים/gi, ""],
  [/\s*במיילים\./gi, "."],
  [/\s*במיילים/gi, ""],
  [/\bGmail\b/gi, ""],
  [/\bCRM\b/gi, ""],
  [/\bDatabase\b/gi, ""],
  [/\bAPI\b/gi, ""],
  [/\bJSON\b/gi, ""],
  [/\bPrompt\b/gi, ""],
  [/\bProvider\b/gi, ""],
  [/\bModel\b/gi, ""],
  [/\bTool\b/gi, ""],
  [/\bCache\b/gi, ""],
  [/\bSync\b/gi, ""],
  [/^source\s*:\s*[^\n—-]+[—-]\s*/gim, ""],
  [/מקור נתונים\s*:\s*[^.\n]+(?:\([^)]*\))?(?:\.\s*|$)/gi, ""],
  [/תמונה מלאה/gi, ""],
  [/תמונה אינה מלאה/gi, ""],
  [/התמונה אינה מלאה/gi, ""],
  [/אומת בהצלחה/gi, ""],
  [/Invalid token/gi, "פג תוקף ההתחברות"],
  [/לא הצלחתי לאמת כרגע את היומן ב-Google/gi, "לא הצלחתי לבדוק את היומן כרגע"],
  [/לא הצלחתי לאמת כרגע את היומן/gi, "לא הצלחתי לבדוק את היומן כרגע"],
  [/לכן איני יכולה להתחייב שהתמונה מלאה/gi, ""],
  [/לכן איני יכולה להתחייב שאין פגישות/gi, "אז ייתכן שיש פגישות שלא מופיעות כאן"],
  [/התחברתי ל/gi, "בדקתי את "],
  [/ניגשתי ל/gi, "בדקתי את "],
  [/השתמשתי ב/gi, "בדקתי את "],
  [/while fetching events/gi, ""],
  [/timeout/gi, "לא הצלחתי כרגע"],
  [/בהתאם לנתונים[^.!?\n]*/g, ""],
  [/לפי הנתונים (?:הקיימים|שסופקו)[^.!?\n]*/g, NATALIE_CUSTOMER_EMPTY],
  [/על בסיס (?:מספרי )?העסק[^.!?\n]*/g, ""],
  [/בנתונים שסופקו לי[^.!?\n]*/g, "אצלי במערכת"],
];

const NATURAL_ACTION_LEAD =
  /^(בדקתי|מצאתי|עדכנתי|שלחתי|קבעתי|ביטלתי|העברתי|הוספתי|הכנתי|סיימתי|לא הצלחתי|הבנתי|שלום|בוקר|ערב|לילה|צהריים|כן[,\s]|לא[,\s])/u;

export function findForbiddenCustomerOutput(text: string): string | null {
  for (const forbidden of FORBIDDEN_CUSTOMER_OUTPUT_STRINGS) {
    if (forbidden === "Source") {
      if (/\bsource\b/i.test(text)) return forbidden;
      continue;
    }
    if (text.includes(forbidden)) return forbidden;
  }
  return null;
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripTechnicalLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      return !STRIP_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
    })
    .join("\n");
}

function cleanupDanglingSourceFragments(text: string): string {
  return text
    .replace(/\s+מ-\.\s*/g, " ")
    .replace(/\s+מ-\s*/g, " ")
    .replace(/^\.\s+/g, "")
    .replace(/\s+\.(?=\s|$)/g, ".")
    .replace(/\.{2,}/g, ".")
    .trim();
}

function applyActionFraming(text: string): string {
  const trimmed = cleanupDanglingSourceFragments(text.trim());
  if (!trimmed || /[?؟]$/.test(trimmed)) return trimmed;

  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;
  if (NATURAL_ACTION_LEAD.test(firstLine)) return trimmed;

  if (/^אין(?: לך)? פגישות\.?$/u.test(trimmed)) {
    return "בדקתי את היומן שלך. אין לך פגישות מתוכננות כרגע.";
  }

  if (/^אין לך פגישות קרובות ביומן\.?$/u.test(trimmed)) {
    return "בדקתי את היומן שלך. אין לך פגישות מתוכננות כרגע.";
  }

  if (/^אין לך פגישות/u.test(trimmed)) {
    const body = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
    return `בדקתי את היומן שלך. ${body}`;
  }

  if (
    /^(?:התורים|הפגישה|יש לך|כרגע אין|אלה שעדיין)/u.test(firstLine) ||
    /^יש לך (?:פגישה|לקוח)/u.test(firstLine)
  ) {
    return `בדקתי את היומן שלך. ${trimmed}`;
  }

  if (/^מצאתי /u.test(trimmed)) return trimmed;

  if (/^(?:יש|אין) /u.test(firstLine) && /פגיש|תור|לקוח/u.test(trimmed)) {
    return `בדקתי את היומן שלך. ${trimmed}`;
  }

  return trimmed;
}

export function sanitizeNatalieCustomerResponse(raw: string | null | undefined): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = stripTechnicalLines(text);
  text = cleanupDanglingSourceFragments(text);
  text = collapseWhitespace(text);
  text = applyActionFraming(text);

  return text.trim();
}

export function sanitizeNatalieCustomerResponseOrFallback(raw: string | null | undefined): string {
  const sanitized = sanitizeNatalieCustomerResponse(raw);
  return sanitized || NATALIE_CUSTOMER_EMPTY;
}

export function finalizeCustomerFacingResponses(input: {
  displayResponse: string;
  spokenResponse: string;
}): { displayResponse: string; spokenResponse: string } {
  return {
    displayResponse: sanitizeNatalieCustomerResponse(input.displayResponse),
    spokenResponse: sanitizeNatalieCustomerResponse(input.spokenResponse),
  };
}
