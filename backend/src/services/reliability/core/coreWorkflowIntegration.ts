import { buildCoreAuditEvent } from "./coreAudit.js";
import { classifyCoreError } from "./coreErrors.js";
import { recordCoreDiagnostic } from "./coreDiagnostics.js";
import { resolveCoreWorkflowCorrelationId } from "./coreAdapters.js";
import { buildCoreHealthSnapshot } from "./coreHealth.js";
import { guardCoreInvariant } from "./coreInvariants.js";
import type {
  NatalieCoreAuditEvent,
  NatalieCoreAuditEventType,
  NatalieCoreHealthStatus,
} from "./coreTypes.js";

export type CoreWorkflowTrace = {
  correlationId: string;
  subsystem: string;
  organizationId?: string | null;
  entityId?: string | null;
  workflow?: string | null;
};

export function createCoreWorkflowTrace(input: {
  subsystem: string;
  organizationId?: string | null;
  entityId?: string | null;
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
  explicit?: string | null;
  parent?: string | null;
  workflow?: string | null;
}): CoreWorkflowTrace {
  const correlationId = resolveCoreWorkflowCorrelationId({
    gmailMessageId: input.gmailMessageId,
    emailMessageId: input.emailMessageId,
    explicit: input.explicit,
    parent: input.parent,
    prefix: input.subsystem,
  });
  return {
    correlationId,
    subsystem: input.subsystem,
    organizationId: input.organizationId ?? null,
    entityId: input.entityId ?? null,
    workflow: input.workflow ?? null,
  };
}

function publishCoreWorkflowAuditEvent(
  trace: CoreWorkflowTrace,
  event: NatalieCoreAuditEvent
) {
  recordCoreDiagnostic({
    subsystem: trace.subsystem,
    kind: `workflow:${event.type}`,
    message: `${event.stage}: ${event.message ?? event.type}`,
    correlationId: trace.correlationId,
    metadata: {
      workflow: trace.workflow,
      organizationId: trace.organizationId,
      entityId: trace.entityId,
      auditEvent: event,
    },
  });
}

export function emitCoreWorkflowAudit(
  trace: CoreWorkflowTrace,
  type: NatalieCoreAuditEventType,
  stage: string,
  input?: { message?: string | null; metadata?: Record<string, unknown> | null }
): NatalieCoreAuditEvent {
  const event = buildCoreAuditEvent({
    type,
    subsystem: trace.subsystem,
    stage,
    correlationId: trace.correlationId,
    organizationId: trace.organizationId ?? null,
    entityId: trace.entityId ?? null,
    message: input?.message ?? null,
    metadata: input?.metadata ?? null,
  });
  publishCoreWorkflowAuditEvent(trace, event);
  return event;
}

export function emitCoreWorkflowFailure(
  trace: CoreWorkflowTrace,
  stage: string,
  error: unknown,
  input?: { userFacing?: boolean }
) {
  const classified = classifyCoreError(error, { userFacing: input?.userFacing });
  emitCoreWorkflowAudit(trace, "failed", stage, {
    message: classified.message,
    metadata: { classified },
  });
  reportCoreWorkflowHealth(trace, "Failed", classified.message);
  return classified;
}

export function reportCoreWorkflowHealth(
  trace: CoreWorkflowTrace,
  status: NatalieCoreHealthStatus,
  message?: string | null
) {
  const snapshot = buildCoreHealthSnapshot({
    subsystemId: trace.subsystem,
    status,
    message,
  });
  recordCoreDiagnostic({
    subsystem: trace.subsystem,
    kind: "workflow:health",
    message: message ?? status,
    correlationId: trace.correlationId,
    metadata: { health: snapshot, workflow: trace.workflow },
  });
  return snapshot;
}

export function completeCoreWorkflowStage(
  trace: CoreWorkflowTrace,
  stage: string,
  outcome: NatalieCoreAuditEventType,
  input?: {
    message?: string | null;
    health?: NatalieCoreHealthStatus;
    metadata?: Record<string, unknown> | null;
  }
) {
  emitCoreWorkflowAudit(trace, outcome, stage, {
    message: input?.message,
    metadata: input?.metadata,
  });
  if (input?.health) {
    reportCoreWorkflowHealth(trace, input.health, input.message);
  }
}

export function guardCoreWorkflowInvariant<T>(
  trace: CoreWorkflowTrace,
  stage: string,
  value: T,
  validate: (candidate: T) => boolean,
  message: string,
  fallback: T
) {
  const result = guardCoreInvariant(value, validate, message, fallback);
  if (result.recovered) {
    emitCoreWorkflowAudit(trace, "recovered", stage, {
      message: result.violation ?? message,
      metadata: { recovered: true },
    });
  }
  return result;
}
