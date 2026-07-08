/**
 * Knowledge Center command entry point — delegates to Business Memory (Phase 2).
 *
 * @deprecated Prefer processBusinessMemoryCommand.
 */

import { processBusinessMemoryCommand } from "../businessMemory/businessMemoryAIService.js";
import { parseKnowledgeIntent } from "./knowledgeIntentParser.js";
import type { KnowledgeDocumentSummary, KnowledgeCategory } from "./knowledgeTypes.js";
import { toKnowledgeDocumentSummary } from "./knowledgeCompat.js";

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
  const legacyIntent = parseKnowledgeIntent(input.text);
  const response = await processBusinessMemoryCommand(input);

  return {
    intent: {
      intent: legacyIntent.intent,
      mode: response.intent.mode,
      category: response.intent.documentType,
      subject: response.intent.subject,
    },
    result: {
      ok: response.result.ok,
      mode: response.result.mode,
      count: response.result.count,
      documents: response.result.documents.map(toKnowledgeDocumentSummary),
    },
    message: response.message,
  };
}
