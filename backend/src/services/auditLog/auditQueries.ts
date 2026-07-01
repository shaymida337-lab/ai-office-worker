import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { mapRowToRecord } from "./auditWriter.js";
import type { PlatformAuditListFilters, PlatformAuditListResult } from "./auditTypes.js";

export type PlatformAuditReadDb = Pick<typeof prisma, "platformAuditLog">;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function parseAuditListFilters(
  organizationId: string,
  query: Record<string, unknown>,
): PlatformAuditListFilters {
  const limitRaw = Number(query.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : DEFAULT_LIMIT;

  return {
    organizationId,
    entityType: typeof query.entityType === "string" ? query.entityType : undefined,
    entityId: typeof query.entityId === "string" ? query.entityId : undefined,
    actorId: typeof query.actorId === "string" ? query.actorId : undefined,
    action: typeof query.action === "string" ? query.action : undefined,
    correlationId: typeof query.correlationId === "string" ? query.correlationId : undefined,
    severity: typeof query.severity === "string" ? query.severity : undefined,
    from: query.from ? new Date(String(query.from)) : undefined,
    to: query.to ? new Date(String(query.to)) : undefined,
    cursor: typeof query.cursor === "string" ? query.cursor : undefined,
    limit,
  };
}

export async function listPlatformAuditLogs(
  filters: PlatformAuditListFilters,
  db: PlatformAuditReadDb = prisma,
): Promise<PlatformAuditListResult> {
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const where: Prisma.PlatformAuditLogWhereInput = {
    organizationId: filters.organizationId,
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const rows = await db.platformAuditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor
      ? {
          cursor: { id: filters.cursor },
          skip: 1,
        }
      : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map(mapRowToRecord),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    totalInPage: page.length,
  };
}

export async function listPlatformAuditLogsForEntity(
  organizationId: string,
  entityType: string,
  entityId: string,
  options: Omit<PlatformAuditListFilters, "organizationId" | "entityType" | "entityId"> = {},
  db: PlatformAuditReadDb = prisma,
): Promise<PlatformAuditListResult> {
  return listPlatformAuditLogs(
    {
      organizationId,
      entityType,
      entityId,
      ...options,
    },
    db,
  );
}
