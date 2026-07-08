/**
 * Knowledge search service — the ONE knowledge engine.
 *
 * Chat, voice, WhatsApp, and any future channel call this exact function. It
 * parses the deterministic intent (unless one is supplied), queries the
 * organization-isolated repository, and returns both structured results and a
 * ready-to-send Hebrew message. No channel-specific document logic lives
 * anywhere else.
 */

import {
  parseKnowledgeIntent,
  type KnowledgeIntentExtraction,
  type KnowledgeIntentMode,
} from "./knowledgeIntentParser.js";
import {
  countKnowledgeDocuments,
  searchKnowledgeDocuments,
} from "./knowledgeRepository.js";
import { knowledgeMessages } from "./knowledgeMessages.js";
import type { KnowledgeDocumentSummary } from "./knowledgeTypes.js";

export type KnowledgeLookupResult = {
  intent: KnowledgeIntentExtraction;
  mode: KnowledgeIntentMode;
  documents: KnowledgeDocumentSummary[];
  count: number;
  message: string;
};

export async function runKnowledgeLookup(input: {
  organizationId: string;
  text: string;
  extraction?: KnowledgeIntentExtraction;
}): Promise<KnowledgeLookupResult> {
  const extraction = input.extraction ?? parseKnowledgeIntent(input.text);

  if (extraction.mode === "count") {
    const count = await countKnowledgeDocuments({
      organizationId: input.organizationId,
      category: extraction.category,
    });
    return {
      intent: extraction,
      mode: "count",
      documents: [],
      count,
      message: knowledgeMessages.count(count, extraction.category ?? "other"),
    };
  }

  const documents = await searchKnowledgeDocuments({
    organizationId: input.organizationId,
    category: extraction.category,
    subject: extraction.subject,
  });

  if (documents.length === 0) {
    return {
      intent: extraction,
      mode: extraction.mode,
      documents,
      count: 0,
      message: knowledgeMessages.notFound(extraction.subject),
    };
  }

  let message: string;
  if (extraction.mode === "list") {
    message = knowledgeMessages.list(documents);
  } else if (documents.length === 1) {
    message = knowledgeMessages.foundOne(documents[0]);
  } else {
    message = knowledgeMessages.foundMany(documents);
  }

  return {
    intent: extraction,
    mode: extraction.mode,
    documents,
    count: documents.length,
    message,
  };
}
