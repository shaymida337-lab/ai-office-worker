import type {
  ReliabilityEvent,
  ReliabilityEventSeverity,
  ReliabilityIsoTimestamp,
  ReliabilitySubsystemId,
} from "./reliabilityTypes.js";
import { RELIABILITY_EVENT_SEVERITIES } from "./reliabilityTypes.js";

export type BuildReliabilityEventInput = {
  subsystem: ReliabilitySubsystemId;
  stage: string;
  severity: ReliabilityEventSeverity;
  timestamp?: ReliabilityIsoTimestamp;
  organizationId?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  probableRootCause?: string | null;
  suggestedAction?: string | null;
  autoRecoverable?: boolean;
  message?: string | null;
};

export function buildReliabilityEvent(input: BuildReliabilityEventInput): ReliabilityEvent {
  return {
    subsystem: input.subsystem,
    stage: input.stage.trim() || "unknown",
    severity: input.severity,
    timestamp: input.timestamp ?? new Date().toISOString(),
    organizationId: input.organizationId ?? null,
    entityId: input.entityId ?? null,
    correlationId: input.correlationId ?? null,
    probableRootCause: input.probableRootCause ?? null,
    suggestedAction: input.suggestedAction ?? null,
    autoRecoverable: input.autoRecoverable ?? false,
    message: input.message ?? null,
  };
}

export function isReliabilityEvent(value: unknown): value is ReliabilityEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as ReliabilityEvent;
  return (
    typeof event.subsystem === "string" &&
    typeof event.stage === "string" &&
    isReliabilityEventSeverity(event.severity) &&
    typeof event.timestamp === "string" &&
    typeof event.autoRecoverable === "boolean"
  );
}

export function isReliabilityEventSeverity(value: unknown): value is ReliabilityEventSeverity {
  return (
    typeof value === "string" &&
    (RELIABILITY_EVENT_SEVERITIES as readonly string[]).includes(value)
  );
}

export function compareReliabilityEventsBySeverity(
  left: ReliabilityEvent,
  right: ReliabilityEvent,
): number {
  return severityRank(right.severity) - severityRank(left.severity);
}

function severityRank(severity: ReliabilityEventSeverity): number {
  switch (severity) {
    case "CRITICAL":
      return 4;
    case "IMPORTANT":
      return 3;
    case "WARNING":
      return 2;
    case "INFO":
      return 1;
    default:
      return 0;
  }
}
