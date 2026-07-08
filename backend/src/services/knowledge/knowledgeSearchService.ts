/**
 * Knowledge search service — delegates to Natalie Business Memory (Phase 2).
 *
 * @deprecated Prefer runBusinessMemoryLookup from businessMemorySearchService.
 * Kept so legacy imports and /knowledge/* routes stay compatible.
 */

import {
  runBusinessMemoryLookup,
  type BusinessMemoryLookupResult,
} from "../businessMemory/businessMemorySearchService.js";
import {
  parseKnowledgeIntent,
  type KnowledgeIntentExtraction,
  type KnowledgeIntentMode,
} from "./knowledgeIntentParser.js";
import type { KnowledgeDocumentSummary } from "./knowledgeTypes.js";
import { toKnowledgeDocumentSummary } from "./knowledgeCompat.js";

export type KnowledgeLookupResult = {
  intent: KnowledgeIntentExtraction;
  mode: KnowledgeIntentMode;
  documents: KnowledgeDocumentSummary[];
  count: number;
  message: string;
};

function mapResult(lookup: BusinessMemoryLookupResult): KnowledgeLookupResult {
  const extraction = parseKnowledgeIntent(lookup.intent.rawText);
  return {
    intent: extraction,
    mode: lookup.mode,
    documents: lookup.documents.map(toKnowledgeDocumentSummary),
    count: lookup.count,
    message: lookup.message,
  };
}

export async function runKnowledgeLookup(input: {
  organizationId: string;
  text: string;
  extraction?: KnowledgeIntentExtraction;
}): Promise<KnowledgeLookupResult> {
  const lookup = await runBusinessMemoryLookup({
    organizationId: input.organizationId,
    text: input.text,
    extraction: input.extraction
      ? {
          intent:
            input.extraction.intent === "knowledge_lookup"
              ? "business_memory_lookup"
              : "unknown",
          mode: input.extraction.mode,
          documentType: input.extraction.category,
          subject: input.extraction.subject,
          rawText: input.extraction.rawText,
        }
      : undefined,
  });
  return mapResult(lookup);
}
