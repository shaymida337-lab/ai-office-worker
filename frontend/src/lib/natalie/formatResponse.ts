/** Customer-facing fallback when an AI answer is empty after cleanup. */
export const NATALIE_EMPTY_ANSWER = "לא מצאתי את זה אצלי כרגע.";

const LITERAL_PLACEHOLDER = "\uE000";
const LITERAL_SUFFIX = "\uE001";

/** Longer keys first so e.g. supplier_payment wins over payment. */
const INTERNAL_STATUS_LABELS: Record<string, string> = {
  supplier_payment: "תשלום לספק",
  pending_review: "ממתין לבדיקה",
  needs_review: "דורש בדיקה",
  missing_invoice: "חסרה חשבונית",
  duplicate_detected: "כפילות",
  not_financial: "לא מסמך כספי",
  auto_saved: "נשמר אוטומטית",
  approved: "מאושר",
  rejected: "נדחה",
  cancelled: "בוטל",
  completed: "הושלם",
  processing: "בעיבוד",
  overdue: "באיחור",
  scanned: "נסרק",
  pending: "ממתין",
  invoice: "חשבונית",
  receipt: "קבלה",
  unpaid: "לא שולם",
  running: "בתהליך",
  partial: "הושלם עם שגיאות",
  success: "הושלם",
  failed: "נכשל",
  draft: "טיוטה",
  error: "שגיאה",
  paid: "שולם",
  sent: "נשלח",
};

const TECHNICAL_FIELD_NAMES = [
  "organizationId",
  "userId",
  "documentId",
  "createdAt",
  "updatedAt",
] as const;

const TECHNICAL_LITERALS = ["null", "undefined", "NaN", "true", "false"] as const;

const TECHNICAL_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/בהתאם לנתונים[^.!?\n]*/g, ""],
  [/לפי הנתונים (?:הקיימים|שסופקו)[^.!?\n]*/g, NATALIE_EMPTY_ANSWER],
  [/על בסיס (?:מספרי )?העסק[^.!?\n]*/g, ""],
  [/בנתונים שסופקו לי[^.!?\n]*/g, "אצלי במערכת"],
  [/Invalid token/gi, "פג תוקף ההתחברות"],
];

const NATURAL_ANSWER_MAX_CHARS = 280;
const NATURAL_ANSWER_MAX_LINES = 5;

/**
 * Formats raw AI text for display — strips markdown, internal codes, and data dumps.
 * Display-only; does not change backend behavior or AI prompts.
 */
export function formatNatalieResponse(raw: string | null | undefined): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  const leakedAnswer = extractAnswerFromJsonLeak(text);
  if (leakedAnswer) {
    text = leakedAnswer.trim();
  }

  if (isNaturalHebrewAnswer(text)) {
    return collapseWhitespace(replaceTechnicalPhrasing(text));
  }

  const protectedLiterals = protectLiterals(text);
  text = protectedLiterals.text;

  text = stripMarkdown(text);
  text = convertMarkdownTables(text);
  text = replaceInternalCodes(text);
  text = removeJsonFragments(text);
  text = removeTechnicalWords(text);
  text = normalizeListSyntax(text);
  text = replaceTechnicalPhrasing(text);
  text = humanizeRemainingSnakeCase(text);
  text = restoreLiterals(text, protectedLiterals.slots);
  text = collapseWhitespace(text);
  text = limitResponseLines(text);

  return text.trim();
}

export function formatNatalieResponseOrFallback(raw: string | null | undefined): string {
  const formatted = formatNatalieResponse(raw);
  return formatted || NATALIE_EMPTY_ANSWER;
}

function isNaturalHebrewAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || !/[\u0590-\u05FF]/.test(trimmed)) return false;

  const lines = trimmed.split("\n").filter((line) => line.trim());
  if (lines.length > NATURAL_ANSWER_MAX_LINES || trimmed.length > NATURAL_ANSWER_MAX_CHARS) {
    return false;
  }

  const redFlags = [
    /\*\*|__|```/,
    /^#{1,6}\s/m,
    /^(\*{3,}|-{3,}|_{3,})\s*$/m,
    /^\s*[-*•]\s+/m,
    /\{[\s\S]*"[\w]+"\s*:/,
    /\b(?:organizationId|userId|documentId|createdAt|updatedAt)\b/i,
    /\b(?:null|undefined|NaN)\b/i,
    /\b(?:true|false)\b/i,
    /\|[\s\-:|]+\|/,
    /^\s*[\[{]/m,
    /\b[a-z]+_[a-z_]+\b/i,
    /\b(?:needs_review|pending_review|approved|paid|unpaid|overdue|draft|cancelled|completed|failed|processing|scanned|invoice|receipt|supplier_payment)\b/i,
  ];

  return !redFlags.some((pattern) => pattern.test(trimmed));
}

function extractAnswerFromJsonLeak(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && "answer" in parsed) {
      const answer = (parsed as { answer?: unknown }).answer;
      if (typeof answer === "string" && answer.trim()) return answer;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function protectLiterals(text: string): { text: string; slots: string[] } {
  const slots: string[] = [];
  const mark = (match: string) => {
    const id = slots.length;
    slots.push(match);
    return `${LITERAL_PLACEHOLDER}${id}${LITERAL_SUFFIX}`;
  };

  let out = text;
  out = out.replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, mark);
  out = out.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, mark);
  out = out.replace(/₪\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*₪/g, mark);
  out = out.replace(/#[-\w\d]+/g, mark);
  out = out.replace(/\bINV-[\w\d-]+/gi, mark);
  return { text: out, slots };
}

function restoreLiterals(text: string, slots: string[]): string {
  return text.replace(
    new RegExp(`${LITERAL_PLACEHOLDER}(\\d+)${LITERAL_SUFFIX}`, "g"),
    (_, index) => slots[Number(index)] ?? ""
  );
}

function stripMarkdown(text: string): string {
  let out = text;
  out = out.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/^(\*{3,}|-{3,}|_{3,})\s*$/gm, "");
  out = out.replace(/\*\*(.+?)\*\*/g, "$1");
  out = out.replace(/__(.+?)__/g, "$1");
  out = out.replace(/\*(.+?)\*/g, "$1");
  out = out.replace(/_(.+?)_/g, "$1");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  out = out.replace(/^>\s?/gm, "");
  return out;
}

function convertMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!isMarkdownTableRow(line)) {
      output.push(line);
      index += 1;
      continue;
    }

    const tableLines: string[] = [];
    while (index < lines.length && isMarkdownTableRow(lines[index])) {
      tableLines.push(lines[index]);
      index += 1;
    }
    output.push(...tableToHebrewLines(tableLines));
  }

  return output.join("\n");
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.replace(/\|/g, "").trim().length > 0;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s\-:|]+\|?\s*$/.test(line.trim());
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function tableToHebrewLines(tableLines: string[]): string[] {
  const rows = tableLines.filter((line) => !isTableSeparator(line)).map(splitTableCells);
  if (rows.length === 0) return [];

  const [header, ...body] = rows;
  if (body.length === 0) {
    return [header.join(" — ")];
  }

  return body.map((row) => {
    if (header.length === row.length && header.length > 1) {
      return row.map((cell, cellIndex) => `${header[cellIndex]}: ${cell}`).join(", ");
    }
    return row.join(" — ");
  });
}

function replaceInternalCodes(text: string): string {
  let out = text;
  const entries = Object.entries(INTERNAL_STATUS_LABELS).sort(([a], [b]) => b.length - a.length);
  for (const [code, label] of entries) {
    const pattern = new RegExp(`\\b${code}\\b`, "gi");
    out = out.replace(pattern, label);
  }
  return out;
}

function removeJsonFragments(text: string): string {
  let out = text;
  out = out.replace(/\{[^{}]*"[\w]+"\s*:[\s\S]*?\}/g, "");
  out = out.replace(/\[[^\[\]]*\{[\s\S]*?\}[^\[\]]*\]/g, "");
  out = out.replace(/^\s*[\[{][\s\S]*$/gm, "");
  return out;
}

function removeTechnicalWords(text: string): string {
  let out = text;
  for (const field of TECHNICAL_FIELD_NAMES) {
    out = out.replace(new RegExp(`${field}\\s*[:=]\\s*["']?[^\\s"',}\\]]+["']?`, "gi"), "");
    out = out.replace(new RegExp(`\\b${field}\\b`, "gi"), "");
  }
  for (const literal of TECHNICAL_LITERALS) {
    out = out.replace(new RegExp(`\\b${literal}\\b`, "gi"), "");
  }
  return out;
}

function normalizeListSyntax(text: string): string {
  return text
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "");
}

function replaceTechnicalPhrasing(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TECHNICAL_PHRASE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function humanizeRemainingSnakeCase(text: string): string {
  return text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, (token) => {
    if (INTERNAL_STATUS_LABELS[token.toLowerCase() as keyof typeof INTERNAL_STATUS_LABELS]) {
      return token;
    }
    return token.replace(/_/g, " ");
  });
}

function limitResponseLines(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length <= NATURAL_ANSWER_MAX_LINES) return lines.join("\n");
  return lines.slice(0, NATURAL_ANSWER_MAX_LINES).join("\n");
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
