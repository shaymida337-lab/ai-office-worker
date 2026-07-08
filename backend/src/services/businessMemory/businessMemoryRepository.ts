/**
 * Business Memory Repository — the ONE repository interface.
 *
 * Unified search, unified lookup, source routing, organization isolation.
 * All channels (chat, voice, WhatsApp, API, future mobile) query here.
 * Source adapters write through upsertBusinessMemoryDocument; reads never
 * branch by channel.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditSnapshot } from "../auditLog/auditSnapshots.js";
import {
  type BusinessMemoryDocument,
  type BusinessMemorySearchFilters,
  type BusinessMemorySource,
  type BusinessMemoryUpsertInput,
  isBusinessMemorySource,
  isKnowledgeCategory,
} from "./businessMemoryTypes.js";

type KnowledgeDocumentRow = {
  id: string;
  organizationId: string;
  source: string;
  title: string;
  category: string;
  fileName: string | null;
  customerName: string | null;
  supplierName: string | null;
  tags: string[];
  driveUrl: string | null;
  storageLocation: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  uploadedAt: Date;
};

const DOCUMENT_SELECT = {
  id: true,
  organizationId: true,
  source: true,
  title: true,
  category: true,
  fileName: true,
  customerName: true,
  supplierName: true,
  tags: true,
  driveUrl: true,
  storageLocation: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  uploadedAt: true,
} as const;

const DEFAULT_LIMIT = 20;

/** Serialize app metadata objects into Prisma-compatible JSON input. */
function metadataToPrismaInput(
  value: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  const snapshot = auditSnapshot(value);
  return snapshot ?? undefined;
}

function toMetadata(value: Prisma.JsonValue): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function toBusinessMemoryDocument(row: KnowledgeDocumentRow): BusinessMemoryDocument {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: isBusinessMemorySource(row.source) ? row.source : "manual",
    documentType: isKnowledgeCategory(row.category) ? row.category : "other",
    title: row.title,
    fileName: row.fileName,
    customer: row.customerName,
    supplier: row.supplierName,
    tags: row.tags ?? [],
    driveUrl: row.driveUrl,
    storageLocation: row.storageLocation,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: toMetadata(row.metadata),
  };
}

function buildWhere(filters: BusinessMemorySearchFilters): Prisma.KnowledgeDocumentWhereInput {
  const where: Prisma.KnowledgeDocumentWhereInput = {
    organizationId: filters.organizationId,
  };

  if (filters.documentType) {
    where.category = filters.documentType;
  }

  if (filters.source) {
    where.source = filters.source;
  }

  const subject = filters.subject?.trim();
  const title = filters.title?.trim();
  const searchText = subject ?? title;
  if (searchText) {
    const variants = new Set<string>([searchText]);
    if (searchText.startsWith("ה") && searchText.length > 2) variants.add(searchText.slice(1));
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

export async function searchBusinessMemory(
  filters: BusinessMemorySearchFilters
): Promise<BusinessMemoryDocument[]> {
  const rows = await prisma.knowledgeDocument.findMany({
    where: buildWhere(filters),
    select: DOCUMENT_SELECT,
    orderBy: { uploadedAt: "desc" },
    take: Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), 100),
  });
  return rows.map(toBusinessMemoryDocument);
}

export async function countBusinessMemory(filters: BusinessMemorySearchFilters): Promise<number> {
  return prisma.knowledgeDocument.count({ where: buildWhere(filters) });
}

export async function getBusinessMemoryDocumentById(
  organizationId: string,
  id: string
): Promise<BusinessMemoryDocument | null> {
  const row = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId },
    select: DOCUMENT_SELECT,
  });
  return row ? toBusinessMemoryDocument(row) : null;
}

export async function findBusinessMemoryByDriveFileId(
  organizationId: string,
  driveFileId: string
): Promise<BusinessMemoryDocument | null> {
  const row = await prisma.knowledgeDocument.findFirst({
    where: { organizationId, driveFileId },
    select: DOCUMENT_SELECT,
  });
  return row ? toBusinessMemoryDocument(row) : null;
}

/**
 * Register or refresh a document. When driveFileId is present, updates the
 * existing row instead of creating a duplicate (Drive sync path).
 */
export async function upsertBusinessMemoryDocument(
  input: BusinessMemoryUpsertInput
): Promise<BusinessMemoryDocument> {
  const data = {
    organizationId: input.organizationId,
    source: input.source,
    category: input.documentType,
    title: input.title,
    fileName: input.fileName ?? null,
    clientId: input.clientId ?? null,
    customerName: input.customer ?? null,
    supplierName: input.supplier ?? null,
    supplierTaxId: input.supplierTaxId ?? null,
    tags: input.tags ?? [],
    storageLocation: input.storageLocation ?? null,
    driveUrl: input.driveUrl ?? null,
    driveFileId: input.driveFileId ?? null,
    metadata: metadataToPrismaInput(input.metadata),
    createdById: input.createdById ?? null,
    createdByName: input.createdByName ?? null,
    ...(input.uploadedAt ? { uploadedAt: input.uploadedAt } : {}),
  };

  if (input.driveFileId?.trim()) {
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { organizationId: input.organizationId, driveFileId: input.driveFileId.trim() },
      select: { id: true },
    });
    if (existing) {
      const row = await prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: {
          source: data.source,
          category: data.category,
          title: data.title,
          fileName: data.fileName,
          customerName: data.customerName,
          supplierName: data.supplierName,
          tags: data.tags,
          storageLocation: data.storageLocation,
          driveUrl: data.driveUrl,
          metadata: data.metadata,
          updatedAt: new Date(),
        },
        select: DOCUMENT_SELECT,
      });
      return toBusinessMemoryDocument(row);
    }
  }

  const row = await prisma.knowledgeDocument.create({
    data,
    select: DOCUMENT_SELECT,
  });
  return toBusinessMemoryDocument(row);
}

/** Route a lookup to the correct source record without exposing source logic to callers. */
export async function lookupBusinessMemoryById(
  organizationId: string,
  id: string
): Promise<{ document: BusinessMemoryDocument; source: BusinessMemorySource } | null> {
  const document = await getBusinessMemoryDocumentById(organizationId, id);
  if (!document) return null;
  return { document, source: document.source };
}
