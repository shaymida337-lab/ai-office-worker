/**
 * Legacy Knowledge Repository — compatibility shim only.
 *
 * @deprecated All data access delegates to BusinessMemoryRepository.
 * Do not add query logic here. Knowledge is a source adapter + legacy routes.
 */

import {
  countBusinessMemory,
  getBusinessMemoryDocumentById,
  searchBusinessMemory,
  upsertBusinessMemoryDocument,
} from "../businessMemory/businessMemoryRepository.js";
import type { KnowledgeCategory } from "./knowledgeTypes.js";
import type { KnowledgeDocumentSummary } from "./knowledgeTypes.js";
import {
  knowledgeCreateToBusinessMemoryUpsert,
  knowledgeFiltersToBusinessMemory,
  toKnowledgeDocumentSummary,
} from "./knowledgeCompat.js";

export type KnowledgeSearchFilters = {
  organizationId: string;
  category?: KnowledgeCategory | null;
  /** Free-text subject: matched against customer, supplier, title, filename, tags. */
  subject?: string | null;
  fileName?: string | null;
  tag?: string | null;
  uploadedAfter?: Date | null;
  uploadedBefore?: Date | null;
  limit?: number;
};

export type KnowledgeDocumentCreateInput = {
  organizationId: string;
  category: KnowledgeCategory;
  title: string;
  fileName?: string | null;
  clientId?: string | null;
  customerName?: string | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  tags?: string[];
  storageLocation?: string | null;
  driveUrl?: string | null;
  driveFileId?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  uploadedAt?: Date;
};

export async function searchKnowledgeDocuments(
  filters: KnowledgeSearchFilters
): Promise<KnowledgeDocumentSummary[]> {
  const documents = await searchBusinessMemory(knowledgeFiltersToBusinessMemory(filters));
  return documents.map(toKnowledgeDocumentSummary);
}

export async function countKnowledgeDocuments(filters: KnowledgeSearchFilters): Promise<number> {
  return countBusinessMemory(knowledgeFiltersToBusinessMemory(filters));
}

export async function getKnowledgeDocumentById(
  organizationId: string,
  id: string
): Promise<KnowledgeDocumentSummary | null> {
  const document = await getBusinessMemoryDocumentById(organizationId, id);
  return document ? toKnowledgeDocumentSummary(document) : null;
}

export async function createKnowledgeDocument(
  input: KnowledgeDocumentCreateInput
): Promise<KnowledgeDocumentSummary> {
  const document = await upsertBusinessMemoryDocument(knowledgeCreateToBusinessMemoryUpsert(input));
  return toKnowledgeDocumentSummary(document);
}
