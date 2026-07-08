import { createHash } from "crypto";
import { prisma } from "../../../lib/prisma.js";
import type {
  RecordReliabilityEventInput,
  ReliabilityCenterSeverity,
  ReliabilityCenterStatus,
  ReliabilityEventRecord,
} from "./reliabilityCenterTypes.js";

export type ReliabilityEventDb = Pick<typeof prisma, "reliabilityEvent">;

function normalizePart(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase() || "none";
}

export function buildReliabilityFingerprint(input: {
  organizationId?: string | null;
  module: string;
  errorCode: string;
  route?: string | null;
  job?: string | null;
  component?: string | null;
}): string {
  const raw = [
    normalizePart(input.organizationId),
    normalizePart(input.module),
    normalizePart(input.errorCode),
    normalizePart(input.route),
    normalizePart(input.job),
    normalizePart(input.component),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function mapRow(row: {
  id: string;
  organizationId: string | null;
  userId: string | null;
  module: string;
  severity: string;
  errorCode: string;
  userVisibleMessage: string | null;
  technicalMessage: string | null;
  route: string | null;
  component: string | null;
  job: string | null;
  correlationId: string | null;
  status: string;
  fingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  occurrences: number;
  autoHealed: boolean;
  customerVisible: boolean;
  metadata: unknown;
}): ReliabilityEventRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    module: row.module,
    severity: row.severity as ReliabilityCenterSeverity,
    errorCode: row.errorCode,
    userVisibleMessage: row.userVisibleMessage,
    technicalMessage: row.technicalMessage,
    route: row.route,
    component: row.component,
    job: row.job,
    correlationId: row.correlationId,
    status: row.status as ReliabilityCenterStatus,
    fingerprint: row.fingerprint,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
    occurrences: row.occurrences,
    autoHealed: row.autoHealed,
    customerVisible: row.customerVisible,
    metadata: row.metadata,
  };
}

/**
 * Create or bump an aggregated open reliability event.
 * Repeated identical issues increase `occurrences` instead of duplicating rows.
 */
export async function recordReliabilityEvent(
  input: RecordReliabilityEventInput,
  db: ReliabilityEventDb = prisma
): Promise<{ event: ReliabilityEventRecord; created: boolean }> {
  const now = input.now ?? new Date();
  const fingerprint =
    input.fingerprint?.trim() ||
    buildReliabilityFingerprint({
      organizationId: input.organizationId,
      module: input.module,
      errorCode: input.errorCode,
      route: input.route,
      job: input.job,
      component: input.component,
    });

  const existing = await db.reliabilityEvent.findFirst({
    where: { fingerprint, status: "open" },
  });

  if (existing) {
    const updated = await db.reliabilityEvent.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: now,
        occurrences: { increment: 1 },
        severity: input.severity,
        userVisibleMessage: input.userVisibleMessage ?? existing.userVisibleMessage,
        technicalMessage: input.technicalMessage ?? existing.technicalMessage,
        correlationId: input.correlationId ?? existing.correlationId,
        userId: input.userId ?? existing.userId,
        customerVisible: input.customerVisible ?? existing.customerVisible,
        autoHealed: input.autoHealed ?? existing.autoHealed,
        metadata: (input.metadata ?? existing.metadata) as object | undefined,
      },
    });
    return { event: mapRow(updated), created: false };
  }

  const created = await db.reliabilityEvent.create({
    data: {
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      module: input.module,
      severity: input.severity,
      errorCode: input.errorCode,
      userVisibleMessage: input.userVisibleMessage ?? null,
      technicalMessage: input.technicalMessage ?? null,
      route: input.route ?? null,
      component: input.component ?? null,
      job: input.job ?? null,
      correlationId: input.correlationId ?? null,
      status: "open",
      fingerprint,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: 1,
      autoHealed: input.autoHealed ?? false,
      customerVisible: input.customerVisible ?? false,
      metadata: (input.metadata ?? undefined) as object | undefined,
    },
  });
  return { event: mapRow(created), created: true };
}

export async function resolveReliabilityEvent(input: {
  fingerprint?: string | null;
  eventId?: string | null;
  organizationId?: string | null;
  errorCode?: string | null;
  module?: string | null;
  autoHealed?: boolean;
  now?: Date;
  db?: ReliabilityEventDb;
}): Promise<ReliabilityEventRecord | null> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const where = input.eventId
    ? { id: input.eventId, status: "open" as const }
    : input.fingerprint
      ? { fingerprint: input.fingerprint, status: "open" as const }
      : {
          status: "open" as const,
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          ...(input.module ? { module: input.module } : {}),
        };

  const existing = await db.reliabilityEvent.findFirst({ where });
  if (!existing) return null;

  const updated = await db.reliabilityEvent.update({
    where: { id: existing.id },
    data: {
      status: "resolved",
      resolvedAt: now,
      lastSeenAt: now,
      autoHealed: input.autoHealed ?? existing.autoHealed,
    },
  });
  return mapRow(updated);
}

export async function resolveReliabilityEventsByFingerprintPrefix(input: {
  fingerprintPrefix: string;
  organizationId?: string | null;
  autoHealed?: boolean;
  now?: Date;
  db?: ReliabilityEventDb;
}): Promise<number> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const open = await db.reliabilityEvent.findMany({
    where: {
      status: "open",
      fingerprint: { startsWith: input.fingerprintPrefix },
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    },
    select: { id: true },
    take: 100,
  });
  if (!open.length) return 0;
  const result = await db.reliabilityEvent.updateMany({
    where: { id: { in: open.map((row) => row.id) } },
    data: {
      status: "resolved",
      resolvedAt: now,
      lastSeenAt: now,
      autoHealed: input.autoHealed ?? true,
    },
  });
  return result.count;
}

export async function listOpenReliabilityEvents(input?: {
  organizationId?: string | null;
  customerVisible?: boolean;
  module?: string | null;
  take?: number;
  db?: ReliabilityEventDb;
}): Promise<ReliabilityEventRecord[]> {
  const db = input?.db ?? prisma;
  const rows = await db.reliabilityEvent.findMany({
    where: {
      status: "open",
      ...(input?.organizationId ? { organizationId: input.organizationId } : {}),
      ...(input?.customerVisible != null ? { customerVisible: input.customerVisible } : {}),
      ...(input?.module ? { module: input.module } : {}),
    },
    orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
    take: input?.take ?? 100,
  });
  // severity ranking is lexical for info/warning/error/critical? "critical" < "error" alphabetically — reorder in memory.
  return rows
    .map(mapRow)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

function severityRank(severity: ReliabilityCenterSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}
