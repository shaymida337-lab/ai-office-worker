/**
 * Natalie Business Memory — shared types (Phase 2).
 *
 * The Business Memory is the single conceptual layer above all information
 * sources. Users never need to know whether a document lives in Drive, was
 * uploaded manually, or will eventually come from Gmail/Calendar/CRM.
 *
 * Phase 2 sources: manual upload + Google Drive metadata sync.
 * Future sources register through the same BusinessMemoryDocument shape.
 */

import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_CATEGORY_LABELS_PLURAL,
  type KnowledgeCategory,
  isKnowledgeCategory,
} from "../knowledge/knowledgeTypes.js";

export {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_CATEGORY_LABELS_PLURAL,
  type KnowledgeCategory,
  isKnowledgeCategory,
};

/** Registered information sources inside Business Memory. */
export const BUSINESS_MEMORY_SOURCES = [
  "manual",
  "google_drive",
  /** Legacy rows from Knowledge Center Phase 1 before source column existed. */
  "knowledge",
] as const;

export type BusinessMemorySource = (typeof BUSINESS_MEMORY_SOURCES)[number];

export function isBusinessMemorySource(value: string): value is BusinessMemorySource {
  return (BUSINESS_MEMORY_SOURCES as readonly string[]).includes(value);
}

/** Document type aliases category — one vocabulary for search + display. */
export type BusinessMemoryDocumentType = KnowledgeCategory;

/**
 * Normalized internal document model. Every source adapter must map into this
 * shape so search, lookup, and future AI reasoning share one interface.
 */
export type BusinessMemoryDocument = {
  id: string;
  organizationId: string;
  source: BusinessMemorySource;
  documentType: BusinessMemoryDocumentType;
  title: string;
  fileName: string | null;
  customer: string | null;
  supplier: string | null;
  tags: string[];
  driveUrl: string | null;
  storageLocation: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
};

export type BusinessMemorySearchFilters = {
  organizationId: string;
  documentType?: BusinessMemoryDocumentType | null;
  /** Matched across customer, supplier, title, filename, tags. */
  subject?: string | null;
  title?: string | null;
  fileName?: string | null;
  tag?: string | null;
  source?: BusinessMemorySource | null;
  uploadedAfter?: Date | null;
  uploadedBefore?: Date | null;
  limit?: number;
};

export type BusinessMemoryUpsertInput = {
  organizationId: string;
  source: BusinessMemorySource;
  documentType: BusinessMemoryDocumentType;
  title: string;
  fileName?: string | null;
  clientId?: string | null;
  customer?: string | null;
  supplier?: string | null;
  supplierTaxId?: string | null;
  tags?: string[];
  storageLocation?: string | null;
  driveUrl?: string | null;
  driveFileId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdById?: string | null;
  createdByName?: string | null;
  uploadedAt?: Date;
};
