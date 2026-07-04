import { correctClientNamesInTranscript } from "../nameCorrection.js";
import type { SttCorrection, SttVocabulary } from "./sttAccuracyTypes.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWN_SUPPLIER_ALIASES: Record<string, string> = {
  "חשמל ישראל": "חברת החשמל",
  "חברת חשמל": "חברת החשמל",
  "חשמל": "חברת החשמל",
  "בזק בינלאומי": "בזק",
  וולט: "Wolt",
  wolt: "Wolt",
  פנגו: "Pango",
  pango: "Pango",
};

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost);
    }
    for (let j = 0; j <= b.length; j++) previous[j] = current[j];
  }

  return previous[b.length];
}

function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

function replacePhraseIfPresent(text: string, original: string, corrected: string, corrections: SttCorrection[]) {
  if (!text.includes(original)) return text;
  corrections.push({
    kind: "supplier_name",
    original,
    corrected,
    confidence: 0.95,
    ambiguous: false,
  });
  return text.split(original).join(corrected);
}

function findSupplierMatches(candidate: string, supplierNames: string[]): string[] {
  return supplierNames.filter((name) => {
    const score = similarityScore(candidate, name);
    return score >= 0.78 || levenshteinDistance(candidate.toLowerCase(), name.toLowerCase()) <= 2;
  });
}

function correctSupplierPhrases(text: string, vocabulary: SttVocabulary, corrections: SttCorrection[]): string {
  let normalized = text;

  for (const [alias, canonical] of Object.entries(KNOWN_SUPPLIER_ALIASES)) {
    normalized = replacePhraseIfPresent(normalized, alias, canonical, corrections);
  }

  for (const supplierName of vocabulary.supplierNames) {
    const lowerText = normalized.toLowerCase();
    const lowerSupplier = supplierName.toLowerCase();
    if (lowerText.includes(lowerSupplier)) continue;

    const tokens = supplierName.split(/\s+/).filter((token) => token.length >= 4);
    for (const token of tokens) {
      if (token.length < 4) continue;
      const matches = findSupplierMatches(token, vocabulary.supplierNames);
      if (matches.length === 1 && matches[0] === supplierName) {
        const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "iu");
        if (pattern.test(normalized)) {
          corrections.push({
            kind: "supplier_name",
            original: token,
            corrected: supplierName,
            confidence: 0.82,
            ambiguous: false,
          });
          normalized = normalized.replace(pattern, supplierName);
        }
      }
    }
  }

  return normalized;
}

function correctSupplierNamesOnly(
  text: string,
  vocabulary: SttVocabulary,
  corrections: SttCorrection[],
  ambiguousSuggestions: string[]
): string {
  let normalized = correctSupplierPhrases(text, vocabulary, corrections);

  const words = normalized.split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (word.length < 4 || /^\d/.test(word)) continue;
    const supplierMatches = findSupplierMatches(word, vocabulary.supplierNames);
    if (supplierMatches.length === 1 && supplierMatches[0] !== word) {
      const score = similarityScore(word, supplierMatches[0]!);
      if (score >= 0.85) {
        corrections.push({
          kind: "supplier_name",
          original: word,
          corrected: supplierMatches[0]!,
          confidence: score,
          ambiguous: false,
        });
        normalized = normalized.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "u"), supplierMatches[0]!);
      } else if (score >= 0.72) {
        ambiguousSuggestions.push(supplierMatches[0]!);
      }
    } else if (supplierMatches.length > 1) {
      ambiguousSuggestions.push(...supplierMatches.slice(0, 2));
    }
  }

  return normalized;
}

export type SttNameCorrectionContext = {
  organizationId?: string;
  requestId?: string | null;
};

export function safeCorrectSupplierNamesInTranscript(
  text: string,
  vocabulary: SttVocabulary,
  context?: SttNameCorrectionContext
): {
  text: string;
  corrections: SttCorrection[];
  ambiguousSuggestions: string[];
} {
  const corrections: SttCorrection[] = [];
  const ambiguousSuggestions: string[] = [];
  try {
    const normalized = correctSupplierNamesOnly(text, vocabulary, corrections, ambiguousSuggestions);
    return {
      text: normalized,
      corrections,
      ambiguousSuggestions: [...new Set(ambiguousSuggestions)],
    };
  } catch (err) {
    console.warn("[stt/supplier-normalization] skipped due to error", {
      organizationId: context?.organizationId ?? vocabulary.organizationId,
      requestId: context?.requestId ?? null,
      name: err instanceof Error ? err.name : "Error",
      message: err instanceof Error ? err.message : String(err),
    });
    return { text, corrections: [], ambiguousSuggestions: [] };
  }
}

export function correctBusinessNamesInTranscript(
  text: string,
  vocabulary: SttVocabulary,
  context?: SttNameCorrectionContext
): {
  text: string;
  corrections: SttCorrection[];
  ambiguousSuggestions: string[];
} {
  const corrections: SttCorrection[] = [];
  const ambiguousSuggestions: string[] = [];

  let normalized = correctClientNamesInTranscript(text, vocabulary.clientNames);
  if (normalized !== text) {
    corrections.push({
      kind: "client_name",
      original: text,
      corrected: normalized,
      confidence: 0.86,
      ambiguous: false,
    });
  }

  const supplierResult = safeCorrectSupplierNamesInTranscript(normalized, vocabulary, context);
  normalized = supplierResult.text;
  corrections.push(...supplierResult.corrections);
  ambiguousSuggestions.push(...supplierResult.ambiguousSuggestions);

  return { text: normalized, corrections, ambiguousSuggestions: [...new Set(ambiguousSuggestions)] };
}

export function buildNameClarificationQuestion(suggestions: string[]): string | null {
  const unique = [...new Set(suggestions.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return `התכוונת לספק "${unique[0]}"?`;
  return `התכוונת ל"${unique[0]}" או ל"${unique[1]}"?`;
}
