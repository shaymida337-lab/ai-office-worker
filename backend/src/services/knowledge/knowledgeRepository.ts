/**
 * Knowledge repository — the single, organization-isolated data-access layer
 * for business documents. Every query is scoped by organizationId; there is no
 * code path that reads documents across organizations.
 *
 * Responsibilities (Phase 1): locate documents and search by customer,
 * supplier, filename, document type (category), tags, and upload date. Writes
 * exist so documents can be registered (uploads / seeding); richer ingestion,
 * OCR text, and semantic vectors are future phases layered on these same rows.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  type KnowledgeCategory,
  type KnowledgeDocumentSummary,
  isKnowledgeCategory,
} from "./knowledgeTypes.js";

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

type KnowledgeDocumentRow = {
  id: string;
  title: string;
  category: string;
  fileName: string | null;
  customerName: string | null;
  supplierName: string | null;
  tags: string[];
  driveUrl: string | null;
  storageLocation: string | null;
  uploadedAt: Date;
};

const SUMMARY_SELECT = {
  id: true,
  title: true,
  category: true,
  fileName: true,
  customerName: true,
  supplierName: true,
  tags: true,
  driveUrl: true,
  storageLocation: true,
  uploadedAt: true,
} as const;

const DEFAULT_LIMIT = 20;

function toSummary(row: KnowledgeDocumentRow): KnowledgeDocumentSummary {
  return {
    id: row.id,
    title: row.title,
    category: isKnowledgeCategory(row.category) ? row.category : "other",
    fileName: row.fileName,
    customerName: row.customerName,
    supplierName: row.supplierName,
    tags: row.tags ?? [],
    driveUrl: row.driveUrl,
    storageLocation: row.storageLocation,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

/** Build the organization-scoped Prisma where clause from filters. */
function buildWhere(filters: KnowledgeSearchFilters): Prisma.KnowledgeDocumentWhereInput {
  const where: Prisma.KnowledgeDocumentWhereInput = {
    organizationId: filters.organizationId,
  };

  if (filters.category) {
    where.category = filters.category;
  }

  const subject = filters.subject?.trim();
  if (subject) {
    // Match tolerantly across the fields a person might mean, and strip a single
    // leading Hebrew definite article ("ה") so "המזגן" also finds "מזגן".
    const variants = new Set<string>([subject]);
    if (subject.startsWith("ה") && subject.length > 2) variants.add(subject.slice(1));
    where.OR = [];
    for (const variant of variants) {
      where.OR.push(
        { customerName: { contains: variant, mode: "insensitive" } },
        { supplierName: { contains: variant, mode: "insensitive" } },
        { title: { contains: variant, mode: "insensitive" } },
        { fileName: { contains: variant, mode: "insensitive" } },
        { tags: { has: variant } }
      );
    }
  }

  const fileName = filters.fileName?.trim();
  if (fileName) {
    where.fileName = { contains: fileName, mode: "insensitive" };
  }

  const tag = filters.tag?.trim();
  if (tag) {
    where.tags = { has: tag };
  }

  if (filters.uploadedAfter || filters.uploadedBefore) {
    where.uploadedAt = {};
    if (filters.uploadedAfter) where.uploadedAt.gte = filters.uploadedAfter;
    if (filters.uploadedBefore) where.uploadedAt.lte = filters.uploadedBefore;
  }

  return where;
}

export async function searchKnowledgeDocuments(
  filters: KnowledgeSearchFilters
): Promise<KnowledgeDocumentSummary[]> {
  const rows = await prisma.knowledgeDocument.findMany({
    where: buildWhere(filters),
    select: SUMMARY_SELECT,
    orderBy: { uploadedAt: "desc" },
    take: Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), 100),
  });
  return rows.map(toSummary);
}

export async function countKnowledgeDocuments(filters: KnowledgeSearchFilters): Promise<number> {
  return prisma.knowledgeDocument.count({ where: buildWhere(filters) });
}

export async function getKnowledgeDocumentById(
  organizationId: string,
  id: string
): Promise<KnowledgeDocumentSummary | null> {
  const row = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId },
    select: SUMMARY_SELECT,
  });
  return row ? toSummary(row) : null;
}

export async function createKnowledgeDocument(
  input: KnowledgeDocumentCreateInput
): Promise<KnowledgeDocumentSummary> {
  const row = await prisma.knowledgeDocument.create({
    data: {
      organizationId: input.organizationId,
      category: input.category,
      title: input.title,
      fileName: input.fileName ?? null,
      clientId: input.clientId ?? null,
      customerName: input.customerName ?? null,
      supplierName: input.supplierName ?? null,
      supplierTaxId: input.supplierTaxId ?? null,
      tags: input.tags ?? [],
      storageLocation: input.storageLocation ?? null,
      driveUrl: input.driveUrl ?? null,
      driveFileId: input.driveFileId ?? null,
      createdById: input.createdById ?? null,
      createdByName: input.createdByName ?? null,
      ...(input.uploadedAt ? { uploadedAt: input.uploadedAt } : {}),
    },
    select: SUMMARY_SELECT,
  });
  return toSummary(row);
}
