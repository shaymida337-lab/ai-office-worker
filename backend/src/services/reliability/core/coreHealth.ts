import {
  NATALIE_CORE_HEALTH_STATUSES,
  type NatalieCoreHealthSnapshot,
  type NatalieCoreHealthStatus,
} from "./coreTypes.js";

export { NATALIE_CORE_HEALTH_STATUSES };

export function isKnownCoreHealthStatus(value: unknown): value is NatalieCoreHealthStatus {
  return (
    typeof value === "string" &&
    (NATALIE_CORE_HEALTH_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeCoreHealthStatus(value: unknown): NatalieCoreHealthStatus {
  if (isKnownCoreHealthStatus(value)) return value;
  return "Unknown";
}

export function buildCoreHealthSnapshot(input: {
  subsystemId: string;
  status?: NatalieCoreHealthStatus | unknown;
  checkedAt?: string;
  message?: string | null;
}): NatalieCoreHealthSnapshot {
  return {
    subsystemId: input.subsystemId.trim() || "unknown",
    status: normalizeCoreHealthStatus(input.status),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    message: input.message ?? null,
  };
}
