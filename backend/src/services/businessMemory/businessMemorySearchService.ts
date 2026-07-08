/**
 * Natalie Business Memory — the ONE deterministic lookup engine.
 *
 * Chat, voice, WhatsApp, API, and future mobile all call runBusinessMemoryLookup.
 * No channel-specific search logic exists anywhere else.
 */

import {
  parseBusinessMemoryIntent,
  type BusinessMemoryIntentExtraction,
  type BusinessMemoryIntentMode,
} from "./businessMemoryIntentParser.js";
import { countBusinessMemory, searchBusinessMemory } from "./businessMemoryRepository.js";
import { businessMemoryMessages } from "./businessMemoryMessages.js";
import type { BusinessMemoryDocument } from "./businessMemoryTypes.js";

export type BusinessMemoryLookupResult = {
  intent: BusinessMemoryIntentExtraction;
  mode: BusinessMemoryIntentMode;
  documents: BusinessMemoryDocument[];
  count: number;
  message: string;
};

export async function runBusinessMemoryLookup(input: {
  organizationId: string;
  text: string;
  extraction?: BusinessMemoryIntentExtraction;
}): Promise<BusinessMemoryLookupResult> {
  const extraction = input.extraction ?? parseBusinessMemoryIntent(input.text);

  if (extraction.mode === "count") {
    const count = await countBusinessMemory({
      organizationId: input.organizationId,
      documentType: extraction.documentType,
    });
    return {
      intent: extraction,
      mode: "count",
      documents: [],
      count,
      message: businessMemoryMessages.count(count, extraction.documentType ?? "other"),
    };
  }

  const documents = await searchBusinessMemory({
    organizationId: input.organizationId,
    documentType: extraction.documentType,
    subject: extraction.subject,
  });

  if (documents.length === 0) {
    return {
      intent: extraction,
      mode: extraction.mode,
      documents,
      count: 0,
      message: businessMemoryMessages.notFound(extraction.subject),
    };
  }

  let message: string;
  if (extraction.mode === "list") {
    message = businessMemoryMessages.list(documents);
  } else if (documents.length === 1) {
    message = businessMemoryMessages.foundOne(documents[0]);
  } else {
    message = businessMemoryMessages.foundMany(documents);
  }

  return {
    intent: extraction,
    mode: extraction.mode,
    documents,
    count: documents.length,
    message,
  };
}
