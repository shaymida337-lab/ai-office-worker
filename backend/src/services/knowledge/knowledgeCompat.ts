/**
 * Legacy Knowledge ↔ Business Memory type mapping.
 *
 * KnowledgeDocumentSummary is the Phase-1 public shape used by /api/knowledge/*
 * and existing tests. BusinessMemoryDocument is the canonical internal model.
 */

import type { BusinessMemoryDocument } from "../businessMemory/businessMemoryTypes.js";
import type { KnowledgeDocumentSummary } from "./knowledgeTypes.js";

export function toKnowledgeDocumentSummary(doc: BusinessMemoryDocument): KnowledgeDocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    category: doc.documentType,
    fileName: doc.fileName,
    customerName: doc.customer,
    supplierName: doc.supplier,
    tags: doc.tags,
    driveUrl: doc.driveUrl,
    storageLocation: doc.storageLocation,
    uploadedAt: doc.createdAt,
  };
}

export function knowledgeFiltersToBusinessMemory(
  filters: import("./knowledgeRepository.js").KnowledgeSearchFilters
): import("../businessMemory/businessMemoryTypes.js").BusinessMemorySearchFilters {
  return {
    organizationId: filters.organizationId,
    documentType: filters.category,
    subject: filters.subject,
    fileName: filters.fileName,
    tag: filters.tag,
    uploadedAfter: filters.uploadedAfter,
    uploadedBefore: filters.uploadedBefore,
    limit: filters.limit,
  };
}

export function knowledgeCreateToBusinessMemoryUpsert(
  input: import("./knowledgeRepository.js").KnowledgeDocumentCreateInput
): import("../businessMemory/businessMemoryTypes.js").BusinessMemoryUpsertInput {
  return {
    organizationId: input.organizationId,
    source: "manual",
    documentType: input.category,
    title: input.title,
    fileName: input.fileName,
    clientId: input.clientId,
    customer: input.customerName,
    supplier: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    tags: input.tags,
    storageLocation: input.storageLocation,
    driveUrl: input.driveUrl,
    driveFileId: input.driveFileId,
    createdById: input.createdById,
    createdByName: input.createdByName,
    uploadedAt: input.uploadedAt,
  };
}
