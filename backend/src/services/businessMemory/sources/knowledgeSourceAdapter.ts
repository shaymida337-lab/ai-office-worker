/**
 * Knowledge source adapter — legacy compatibility layer.
 *
 * Maps Phase-1 Knowledge API shapes to Business Memory. All reads and writes
 * go through BusinessMemoryRepository; no duplicate query engine lives here.
 */

import {
  searchBusinessMemory,
  upsertBusinessMemoryDocument,
} from "../businessMemoryRepository.js";
import type { BusinessMemoryDocument, BusinessMemorySearchFilters } from "../businessMemoryTypes.js";
import type { KnowledgeDocumentCreateInput } from "../../knowledge/knowledgeRepository.js";
import { knowledgeCreateToBusinessMemoryUpsert } from "../../knowledge/knowledgeCompat.js";

export async function searchKnowledgeSource(
  filters: BusinessMemorySearchFilters
): Promise<BusinessMemoryDocument[]> {
  return searchBusinessMemory(filters);
}

export async function registerManualDocument(
  input: KnowledgeDocumentCreateInput
): Promise<BusinessMemoryDocument> {
  return upsertBusinessMemoryDocument(knowledgeCreateToBusinessMemoryUpsert(input));
}
