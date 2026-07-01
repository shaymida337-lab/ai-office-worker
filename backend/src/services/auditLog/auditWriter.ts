import type { Prisma, PlatformAuditLog } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  defaultSeverityForAction,
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_ACTOR_TYPES,
  type AppendPlatformAuditInput,
  type PlatformAuditRecord,
} from "./auditTypes.js";
import { auditSnapshot } from "./auditSnapshots.js";
import { maybeEmitAuditReliabilityEvent } from "./auditReliability.js";

export type PlatformAuditDb = Pick<typeof prisma, "platformAuditLog">;

function validateAppendInput(input: AppendPlatformAuditInput): void {
  if (!input.organizationId?.trim()) throw new Error("audit: organizationId required");
  if (!input.entityType?.trim()) throw new Error("audit: entityType required");
  if (!input.entityId?.trim()) throw new Error("audit: entityId required");
  if (!PLATFORM_AUDIT_ACTIONS.includes(input.action)) throw new Error(`audit: invalid action ${input.action}`);
  if (!PLATFORM_AUDIT_ACTOR_TYPES.includes(input.actorType)) {
    throw new Error(`audit: invalid actorType ${input.actorType}`);
  }
  if (!input.sourceModule?.trim()) throw new Error("audit: sourceModule required");
}

/**
 * Append-only audit writer. Never updates or deletes audit rows.
 */
export async function appendPlatformAuditLog(
  input: AppendPlatformAuditInput,
  db: PlatformAuditDb = prisma,
): Promise<PlatformAuditLog> {
  validateAppendInput(input);
  const severity = input.severity ?? defaultSeverityForAction(input.action);

  const row = await db.platformAuditLog.create({
    data: {
      organizationId: input.organizationId,
      correlationId: input.correlationId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      severity,
      sourceModule: input.sourceModule,
      sourceRoute: input.sourceRoute ?? null,
      beforeState: auditSnapshot(input.beforeState as Record<string, unknown> | null | undefined) ?? undefined,
      afterState: auditSnapshot(input.afterState as Record<string, unknown> | null | undefined) ?? undefined,
      reason: input.reason ?? null,
      metadata: auditSnapshot(input.metadata ?? null) ?? undefined,
      createdAt: input.timestamp ?? new Date(),
    },
  });

  maybeEmitAuditReliabilityEvent(mapRowToRecord(row));
  return row;
}

/**
 * Fire-and-forget audit recording — failures are logged, never thrown to callers.
 */
export function recordPlatformAudit(input: AppendPlatformAuditInput): void {
  void appendPlatformAuditLog(input).catch((err) => {
    console.error("[audit] failed to record event", input.action, input.entityId, err);
  });
}

export function mapRowToRecord(row: PlatformAuditLog): PlatformAuditRecord {
  return {
    auditId: row.id,
    timestamp: row.createdAt.toISOString(),
    organizationId: row.organizationId,
    correlationId: row.correlationId,
    actorType: row.actorType as PlatformAuditRecord["actorType"],
    actorId: row.actorId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action as PlatformAuditRecord["action"],
    severity: row.severity as PlatformAuditRecord["severity"],
    sourceModule: row.sourceModule,
    sourceRoute: row.sourceRoute,
    beforeState: row.beforeState,
    afterState: row.afterState,
    reason: row.reason,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

export function systemAuditContext(
  sourceModule: string,
  correlationId?: string | null,
): Pick<AppendPlatformAuditInput, "actorType" | "actorId" | "sourceModule" | "correlationId"> {
  return {
    actorType: "system",
    actorId: null,
    sourceModule,
    correlationId: correlationId ?? null,
  };
}

export function userAuditContext(
  userId: string,
  sourceModule: string,
  sourceRoute?: string | null,
  correlationId?: string | null,
): Pick<AppendPlatformAuditInput, "actorType" | "actorId" | "sourceModule" | "sourceRoute" | "correlationId"> {
  return {
    actorType: "user",
    actorId: userId,
    sourceModule,
    sourceRoute: sourceRoute ?? null,
    correlationId: correlationId ?? null,
  };
}

export function aiAuditContext(
  sourceModule: string,
  correlationId?: string | null,
): Pick<AppendPlatformAuditInput, "actorType" | "actorId" | "sourceModule" | "correlationId"> {
  return {
    actorType: "AI",
    actorId: "natalie",
    sourceModule,
    correlationId: correlationId ?? null,
  };
}
