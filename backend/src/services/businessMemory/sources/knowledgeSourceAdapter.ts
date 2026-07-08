/**
 * Knowledge / manual-upload source adapter.
 *
 * Phase 1 Knowledge Repository rows are one source inside Business Memory.
 * This adapter maps legacy create/search paths into the normalized document model.
 */

import {
  createKnowledgeDocument,
  searchKnowledgeDocuments,
  type KnowledgeDocumentCreateInput,
} from "../../knowledge/knowledgeRepository.js";
import {
  toBusinessMemoryDocument,
  upsertBusinessMemoryDocument,
} from "../businessMemoryRepository.js";
import type { BusinessMemoryDocument, BusinessMemorySearchFilters } from "../businessMemoryTypes.js";
import type { KnowledgeDocumentSummary } from "../../knowledge/knowledgeTypes.js";

/** Map a Phase-1 knowledge summary into the Business Memory document shape. */
export function knowledgeSummaryToBusinessMemory(
  summary: KnowledgeDocumentSummary,
  organizationId: string
): BusinessMemoryDocument {
  return {
    id: summary.id,
    organizationId,
    source: "knowledge",
    documentType: summary.category,
    title: summary.title,
    fileName: summary.fileName,
    customer: summary.customerName,
    supplier: summary.supplierName,
    tags: summary.tags,
    driveUrl: summary.driveUrl,
    storageLocation: summary.storageLocation,
    createdAt: summary.uploadedAt,
    updatedAt: summary.uploadedAt,
    metadata: null,
  };
}

export async function searchKnowledgeSource(
  filters: BusinessMemorySearchFilters
): Promise<BusinessMemoryDocument[]> {
  const rows = await searchKnowledgeDocuments({
    organizationId: filters.organizationId,
    category: filters.documentType,
    subject: filters.subject,
    fileName: filters.fileName,
    tag: filters.tag,
    uploadedAfter: filters.uploadedAfter,
    uploadedBefore: filters.uploadedBefore,
    limit: filters.limit,
  });
  return rows.map((row) => knowledgeSummaryToBusinessMemory(row, filters.organizationId));
}

export async function registerManualDocument(
  input: KnowledgeDocumentCreateInput
): Promise<BusinessMemoryDocument> {
  const row = await createKnowledgeDocument(input);
  return knowledgeSummaryToBusinessMemory(row, input.organizationId);
}

export async function registerBusinessMemoryManual(
  input: Parameters<typeof upsertBusinessMemoryDocument>[0]
): Promise<BusinessMemoryDocument> {
  return upsertBusinessMemoryDocument({ ...input, source: input.source ?? "manual" });
}
