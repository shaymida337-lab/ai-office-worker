import type {
  ReliabilityHealthStatus,
  ReliabilityIsoTimestamp,
  ReliabilitySubsystemId,
  SubsystemHealthContract,
} from "./reliabilityTypes.js";

export type BuildSubsystemHealthInput = {
  subsystemId: ReliabilitySubsystemId;
  status?: ReliabilityHealthStatus;
  successRate?: number | null;
  errorRate?: number | null;
  queueSize?: number | null;
  retryCount?: number | null;
  averageProcessingTimeMs?: number | null;
  lastSuccessfulExecutionAt?: ReliabilityIsoTimestamp | null;
  lastFailureAt?: ReliabilityIsoTimestamp | null;
  activeAlerts?: number;
  warningCount?: number;
  metrics?: SubsystemHealthContract["metrics"];
  summary?: string | null;
  checkedAt?: ReliabilityIsoTimestamp;
};

export function buildSubsystemHealthContract(
  input: BuildSubsystemHealthInput,
): SubsystemHealthContract {
  return {
    subsystemId: input.subsystemId,
    status: input.status ?? "unknown",
    successRate: normalizeRate(input.successRate),
    errorRate: normalizeRate(input.errorRate),
    queueSize: normalizeOptionalCount(input.queueSize),
    retryCount: normalizeOptionalCount(input.retryCount),
    averageProcessingTimeMs: normalizeOptionalDuration(input.averageProcessingTimeMs),
    lastSuccessfulExecutionAt: input.lastSuccessfulExecutionAt ?? null,
    lastFailureAt: input.lastFailureAt ?? null,
    activeAlerts: Math.max(0, input.activeAlerts ?? 0),
    warningCount: Math.max(0, input.warningCount ?? 0),
    metrics: input.metrics,
    summary: input.summary ?? null,
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

export function emptySubsystemHealthContract(
  subsystemId: ReliabilitySubsystemId,
  checkedAt: Date = new Date(),
): SubsystemHealthContract {
  return buildSubsystemHealthContract({
    subsystemId,
    status: "not_configured",
    checkedAt: checkedAt.toISOString(),
  });
}

export function deriveHealthStatusFromRates(input: {
  successRate: number | null;
  errorRate: number | null;
  activeAlerts: number;
  warningCount: number;
}): ReliabilityHealthStatus {
  if (input.activeAlerts > 0) return "unhealthy";
  if (input.errorRate != null && input.errorRate > 0.25) return "unhealthy";
  if (input.warningCount > 0 || (input.errorRate != null && input.errorRate > 0.05)) {
    return "degraded";
  }
  if (input.successRate == null && input.errorRate == null) return "unknown";
  return "healthy";
}

export function isSubsystemHealthContract(value: unknown): value is SubsystemHealthContract {
  if (!value || typeof value !== "object") return false;
  const contract = value as SubsystemHealthContract;
  return (
    typeof contract.subsystemId === "string" &&
    typeof contract.status === "string" &&
    typeof contract.activeAlerts === "number" &&
    typeof contract.warningCount === "number" &&
    typeof contract.checkedAt === "string"
  );
}

function normalizeRate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function normalizeOptionalCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function normalizeOptionalDuration(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}
