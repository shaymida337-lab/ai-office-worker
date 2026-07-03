import { resolveWorkflowCorrelationId } from "../../auditLog/auditTypes.js";
import type { ReliabilityHealthStatus } from "../reliabilityTypes.js";
import { buildCoreAuditEvent } from "./coreAudit.js";
import { propagateCoreCorrelationId } from "./coreCorrelation.js";
import {
  buildCoreHealthSnapshot,
  normalizeCoreHealthStatus,
} from "./coreHealth.js";
import type { NatalieCoreHealthStatus } from "./coreTypes.js";

export function fromReliabilityHealthStatus(status: ReliabilityHealthStatus): NatalieCoreHealthStatus {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "unhealthy":
      return "Failed";
    case "not_configured":
    case "unknown":
    default:
      return "Unknown";
  }
}

export function toReliabilityHealthStatus(status: NatalieCoreHealthStatus): ReliabilityHealthStatus {
  switch (status) {
    case "Healthy":
      return "healthy";
    case "Degraded":
      return "degraded";
    case "Recovering":
      return "degraded";
    case "Failed":
      return "unhealthy";
    case "Unknown":
    default:
      return "unknown";
  }
}

export function resolveCoreWorkflowCorrelationId(input: {
  gmailMessageId?: string | null;
  emailMessageId?: string | null;
  explicit?: string | null;
  parent?: string | null;
  prefix?: string;
}): string {
  const workflowId = resolveWorkflowCorrelationId({
    gmailMessageId: input.gmailMessageId,
    emailMessageId: input.emailMessageId,
    explicit: input.explicit,
  });
  return propagateCoreCorrelationId({
    explicit: workflowId,
    parent: input.parent,
    prefix: input.prefix ?? "workflow",
  });
}

export function adaptReliabilityHealthToCoreSnapshot(input: {
  subsystemId: string;
  status: ReliabilityHealthStatus;
  checkedAt: string;
  summary?: string | null;
}) {
  return buildCoreHealthSnapshot({
    subsystemId: input.subsystemId,
    status: fromReliabilityHealthStatus(input.status),
    checkedAt: input.checkedAt,
    message: input.summary,
  });
}

export function guardCoreHealthStatus(value: unknown): NatalieCoreHealthStatus {
  return normalizeCoreHealthStatus(value);
}

export function buildCoreRecoveryAuditEvent(input: {
  subsystem: string;
  stage: string;
  correlationId?: string | null;
  organizationId?: string | null;
  entityId?: string | null;
  recovered: boolean;
  message?: string | null;
}) {
  return buildCoreAuditEvent({
    type: input.recovered ? "recovered" : "failed",
    subsystem: input.subsystem,
    stage: input.stage,
    correlationId: input.correlationId,
    organizationId: input.organizationId,
    entityId: input.entityId,
    message: input.message,
  });
}
