import {
  NATALIE_CORE_AUDIT_EVENT_TYPES,
  type NatalieCoreAuditEvent,
  type NatalieCoreAuditEventType,
} from "./coreTypes.js";

export { NATALIE_CORE_AUDIT_EVENT_TYPES };

export function isKnownCoreAuditEventType(value: unknown): value is NatalieCoreAuditEventType {
  return (
    typeof value === "string" &&
    (NATALIE_CORE_AUDIT_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export function buildCoreAuditEvent(input: {
  type: NatalieCoreAuditEventType;
  subsystem: string;
  stage: string;
  correlationId?: string | null;
  organizationId?: string | null;
  entityId?: string | null;
  timestamp?: string;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}): NatalieCoreAuditEvent {
  return {
    type: input.type,
    subsystem: input.subsystem.trim() || "unknown",
    stage: input.stage.trim() || "unknown",
    correlationId: input.correlationId ?? null,
    organizationId: input.organizationId ?? null,
    entityId: input.entityId ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
    message: input.message ?? null,
    metadata: input.metadata ?? null,
  };
}
