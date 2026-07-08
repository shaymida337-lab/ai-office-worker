/**
 * Deterministic Hebrew parser for Knowledge Center lookup commands.
 *
 * DB-free and channel-agnostic. Recognizes natural phrasings such as:
 *   "תפתחי לי את החוזה עם שרית"      → open   / contract / subject=שרית
 *   "איפה ההסכם של דני"              → open   / agreement / subject=דני
 *   "תראי לי את האחריות של המזגן"    → open   / warranty  / subject=המזגן
 *   "יש לי הצעת מחיר של רונן?"        → open   / quotation / subject=רונן
 *   "מה כתוב בחוזה עם יוסי"           → open   / contract  / subject=יוסי
 *   "תראי את כל החוזים"              → list   / contract  / subject=null
 *   "כמה חוזים יש לי"                 → count  / contract  / subject=null
 *   "איזה מסמכים יש לשרית"           → list   / other(any) / subject=שרית
 *
 * There is intentionally no LLM here — supported lookup commands must resolve
 * deterministically so every channel behaves identically.
 */

import type { KnowledgeCategory } from "./knowledgeTypes.js";

export type KnowledgeIntentMode = "open" | "list" | "count";

export type KnowledgeIntentExtraction = {
  intent: "knowledge_lookup" | "unknown";
  mode: KnowledgeIntentMode;
  /** null means "any document category". */
  category: KnowledgeCategory | null;
  /** Customer / supplier / item name extracted after של / עם / עבור / ל. */
  subject: string | null;
  rawText: string;
};

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Category noun patterns, most specific first. A match both classifies the
 * document category and marks the phrase as a knowledge lookup. `null` category
 * means a generic document word ("מסמך", "קובץ") — search across all categories.
 */
const CATEGORY_PATTERNS: Array<{ re: RegExp; category: KnowledgeCategory | null }> = [
  { re: /הצע(?:ת|ות)\s+מחיר/u, category: "quotation" },
  { re: /תעוד(?:ת|ות)\s+אחריות/u, category: "warranty" },
  { re: /הוראות\s+הפעלה/u, category: "manual" },
  { re: /חוז(?:ה|ים)/u, category: "contract" },
  { re: /הסכם(?:ים)?/u, category: "agreement" },
  { re: /אחריות/u, category: "warranty" },
  { re: /הצע(?:ה|ות)/u, category: "quotation" },
  { re: /מדריך|מדריכים|הוראות/u, category: "manual" },
  { re: /רישיון|רשיון|רישיונות|רשיונות/u, category: "license" },
  { re: /תעוד(?:ה|ות)|אישור(?:ים)?/u, category: "certificate" },
  { re: /מסמך|מסמכים|קובץ|קבצים/u, category: null },
];

/** Words that must never be treated as a subject/customer name. */
const SUBJECT_STOPWORDS = new Set([
  "לי",
  "לך",
  "לו",
  "לה",
  "לנו",
  "להם",
  "עצמי",
  "שלי",
  "שלך",
  "כל",
  "כולם",
  "את",
  "זה",
  "זו",
  "הזה",
  "במערכת",
  "אצלי",
  "יש",
]);

function detectCategory(text: string): { category: KnowledgeCategory | null; matched: boolean } {
  for (const { re, category } of CATEGORY_PATTERNS) {
    if (re.test(text)) return { category, matched: true };
  }
  return { category: null, matched: false };
}

function detectMode(text: string): KnowledgeIntentMode {
  // NOTE: JS \b uses ASCII word chars, so it never fires between Hebrew letters.
  // Anchor on whitespace/string boundaries instead.
  if (/(?:^|\s)כמה(?:\s|$)/u.test(text)) return "count";
  if (/(?:^|\s)(?:כל|איזה|אילו)(?:\s|$)/u.test(text) || /רשימ/u.test(text)) return "list";
  return "open";
}

function cleanNameToken(token: string): string {
  return token.replace(/[?？.!,"'׳״]+$/u, "").trim();
}

/** Take up to 3 leading tokens, dropping trailing stopwords/punctuation. */
function takeName(rest: string): string | null {
  const tokens = normalize(rest)
    .split(" ")
    .map(cleanNameToken)
    .filter(Boolean);
  const picked: string[] = [];
  for (const token of tokens) {
    if (SUBJECT_STOPWORDS.has(token)) break;
    picked.push(token);
    if (picked.length >= 3) break;
  }
  const name = picked.join(" ").trim();
  return name.length > 0 ? name : null;
}

/**
 * Extract the subject (customer / supplier / item) after של / עם / עבור, or a
 * ל-prefixed name ("לשרית"). של/עם/עבור take priority; ל is the fallback.
 */
function extractSubject(text: string): string | null {
  const stripped = text.replace(/[?？]+$/u, "").trim();

  const afterShel = stripped.match(/(?:^|\s)של\s+(.+)$/u);
  if (afterShel) {
    const name = takeName(afterShel[1]);
    if (name) return name;
  }

  const afterIm = stripped.match(/(?:^|\s)עם\s+(.+)$/u);
  if (afterIm) {
    const name = takeName(afterIm[1]);
    if (name) return name;
  }

  const afterAvur = stripped.match(/(?:^|\s)עבור\s+(.+)$/u);
  if (afterAvur) {
    const name = takeName(afterAvur[1]);
    if (name) return name;
  }

  // ל-prefixed name, e.g. "יש לשרית". Scan every ל-token, return first that is
  // a real name (not a stopword like "לי").
  const lamedTokens = stripped.match(/(?:^|\s)ל([א-ת][^\s]*)/gu);
  if (lamedTokens) {
    for (const raw of lamedTokens) {
      const token = cleanNameToken(raw.trim().replace(/^ל/u, ""));
      if (token && !SUBJECT_STOPWORDS.has(`ל${token}`) && !SUBJECT_STOPWORDS.has(token)) {
        // Never treat a category noun as a subject.
        if (!detectCategory(token).matched) return token;
      }
    }
  }

  return null;
}

export function parseKnowledgeIntent(rawText: string): KnowledgeIntentExtraction {
  const text = normalize(rawText);
  const { category, matched } = detectCategory(text);

  if (!matched) {
    return { intent: "unknown", mode: "open", category: null, subject: null, rawText: text };
  }

  return {
    intent: "knowledge_lookup",
    mode: detectMode(text),
    category,
    subject: extractSubject(text),
    rawText: text,
  };
}

/** Cheap gate used by the brain to decide whether to run the knowledge handler. */
export function isKnowledgeLookupPhrase(rawText: string): boolean {
  return parseKnowledgeIntent(rawText).intent === "knowledge_lookup";
}
