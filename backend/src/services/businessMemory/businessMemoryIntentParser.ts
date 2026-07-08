/**
 * Deterministic Hebrew parser for Natalie Business Memory lookup commands.
 *
 * Extends Phase-1 knowledge patterns with unified "all documents" phrasing.
 * DB-free, channel-agnostic, no LLM.
 */

import {
  parseKnowledgeIntent,
  type KnowledgeIntentExtraction,
  type KnowledgeIntentMode,
} from "../knowledge/knowledgeIntentParser.js";
import type { BusinessMemoryDocumentType } from "./businessMemoryTypes.js";

export type BusinessMemoryIntentMode = KnowledgeIntentMode;

export type BusinessMemoryIntentExtraction = {
  intent: "business_memory_lookup" | "unknown";
  mode: BusinessMemoryIntentMode;
  /** null = any document type. */
  documentType: BusinessMemoryDocumentType | null;
  subject: string | null;
  rawText: string;
};

function mapExtraction(parsed: KnowledgeIntentExtraction): BusinessMemoryIntentExtraction {
  return {
    intent: parsed.intent === "knowledge_lookup" ? "business_memory_lookup" : "unknown",
    mode: parsed.mode,
    documentType: parsed.category,
    subject: parsed.subject,
    rawText: parsed.rawText,
  };
}

export function parseBusinessMemoryIntent(rawText: string): BusinessMemoryIntentExtraction {
  return mapExtraction(parseKnowledgeIntent(rawText));
}

export function isBusinessMemoryLookupPhrase(rawText: string): boolean {
  return parseBusinessMemoryIntent(rawText).intent === "business_memory_lookup";
}

/** @deprecated Use parseBusinessMemoryIntent — kept for Knowledge Center compat. */
export const parseKnowledgeIntentAsBusinessMemory = parseBusinessMemoryIntent;
