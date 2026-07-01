import type { AuditLogAction, AuditLogActorType, AuditLogEntry } from "./hardeningTypes.js";
import { AUDIT_LOG_ACTIONS, AUDIT_LOG_ACTOR_TYPES } from "./hardeningTypes.js";

export type BuildAuditLogEntryInput = {
  actorType: AuditLogActorType;
  actorId: string | null;
  organizationId: string;
  entityType: string;
  entityId: string;
  action: AuditLogAction;
  before: unknown;
  after: unknown;
  reason?: string | null;
  timestamp?: string;
  correlationId?: string | null;
};

export function buildAuditLogEntry(input: BuildAuditLogEntryInput): AuditLogEntry {
  return {
    actorType: input.actorType,
    actorId: input.actorId,
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    before: input.before,
    after: input.after,
    reason: input.reason ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
    correlationId: input.correlationId ?? null,
    immutable: true,
  };
}

export function isFinancialAuditAction(action: AuditLogAction): boolean {
  return (
    action === "payment_created" ||
    action === "payment_changed" ||
    action === "payment_deleted" ||
    action === "document_approved" ||
    action === "document_rejected" ||
    action === "invoice_created" ||
    action === "ai_decision_overridden"
  );
}

export function validateAuditLogEntry(entry: unknown): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object") return ["expected audit log object"];
  const e = entry as AuditLogEntry;
  if (!AUDIT_LOG_ACTOR_TYPES.includes(e.actorType)) errors.push("invalid actorType");
  if (!AUDIT_LOG_ACTIONS.includes(e.action)) errors.push("invalid action");
  if (!e.organizationId) errors.push("organizationId required");
  if (!e.entityId) errors.push("entityId required");
  if (e.immutable !== true) errors.push("audit log must be immutable");
  return errors;
}

export function listRequiredAuditActions(): AuditLogAction[] {
  return [...AUDIT_LOG_ACTIONS];
}
