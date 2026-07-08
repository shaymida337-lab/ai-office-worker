/**
 * Business Memory HTTP/command entry point.
 *
 * Thin layer over runBusinessMemoryLookup — identical behavior to the Natalie
 * brain path and legacy /knowledge/ai/command route.
 */

import { parseBusinessMemoryIntent } from "./businessMemoryIntentParser.js";
import { runBusinessMemoryLookup } from "./businessMemorySearchService.js";
import { businessMemoryMessages } from "./businessMemoryMessages.js";
import type { BusinessMemoryDocument, BusinessMemoryDocumentType } from "./businessMemoryTypes.js";

export type ProcessBusinessMemoryCommandInput = {
  organizationId: string;
  userId: string;
  text: string;
};

export type BusinessMemoryAIResponse = {
  intent: {
    intent: "business_memory_lookup" | "unknown";
    mode: "open" | "list" | "count";
    documentType: BusinessMemoryDocumentType | null;
    subject: string | null;
  };
  result: {
    ok: boolean;
    mode: "open" | "list" | "count";
    count: number;
    documents: BusinessMemoryDocument[];
  };
  message: string;
};

export async function processBusinessMemoryCommand(
  input: ProcessBusinessMemoryCommandInput
): Promise<BusinessMemoryAIResponse> {
  const extraction = parseBusinessMemoryIntent(input.text);

  if (extraction.intent !== "business_memory_lookup") {
    return {
      intent: {
        intent: "unknown",
        mode: extraction.mode,
        documentType: extraction.documentType,
        subject: extraction.subject,
      },
      result: { ok: false, mode: extraction.mode, count: 0, documents: [] },
      message: businessMemoryMessages.notFound(null),
    };
  }

  const lookup = await runBusinessMemoryLookup({
    organizationId: input.organizationId,
    text: input.text,
    extraction,
  });

  return {
    intent: {
      intent: extraction.intent,
      mode: lookup.mode,
      documentType: extraction.documentType,
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
