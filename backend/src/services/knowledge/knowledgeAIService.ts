/**
 * Knowledge Center command entry point used by the HTTP route.
 *
 * Read-only: this never mutates. It delegates to the single knowledge engine
 * (runKnowledgeLookup) so the API behaves identically to the chat/voice/WhatsApp
 * paths that go through the Natalie brain.
 */

import { parseKnowledgeIntent } from "./knowledgeIntentParser.js";
import { runKnowledgeLookup } from "./knowledgeSearchService.js";
import { knowledgeMessages } from "./knowledgeMessages.js";
import type { KnowledgeDocumentSummary, KnowledgeCategory } from "./knowledgeTypes.js";

export type ProcessKnowledgeCommandInput = {
  organizationId: string;
  userId: string;
  text: string;
};

export type KnowledgeAIResponse = {
  intent: {
    intent: "knowledge_lookup" | "unknown";
    mode: "open" | "list" | "count";
    category: KnowledgeCategory | null;
    subject: string | null;
  };
  result: {
    ok: boolean;
    mode: "open" | "list" | "count";
    count: number;
    documents: KnowledgeDocumentSummary[];
  };
  message: string;
};

export async function processKnowledgeCommand(
  input: ProcessKnowledgeCommandInput
): Promise<KnowledgeAIResponse> {
  const extraction = parseKnowledgeIntent(input.text);

  if (extraction.intent !== "knowledge_lookup") {
    return {
      intent: {
        intent: "unknown",
        mode: extraction.mode,
        category: extraction.category,
        subject: extraction.subject,
      },
      result: { ok: false, mode: extraction.mode, count: 0, documents: [] },
      message: knowledgeMessages.notFound(null),
    };
  }

  const lookup = await runKnowledgeLookup({
    organizationId: input.organizationId,
    text: input.text,
    extraction,
  });

  return {
    intent: {
      intent: extraction.intent,
      mode: lookup.mode,
      category: extraction.category,
      subject: extraction.subject,
    },
    result: {
      ok: true,
      mode: lookup.mode,
      count: lookup.count,
      documents: lookup.documents,
    },
    message: lookup.message,
  };
}
