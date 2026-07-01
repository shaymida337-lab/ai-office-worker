import { isReliabilityEvent, isReliabilityEventSeverity } from "./reliabilityEventModel.js";
import { isSubsystemHealthContract } from "./reliabilityHealthContract.js";
import { isReliabilityMetricSample, isReliabilityStandardMetricKey } from "./reliabilityMetrics.js";
import { isRecoveryFrameworkDeclaration } from "./reliabilityRecoveryFramework.js";
import { validateReliabilityRegistryIntegrity } from "./reliabilityRegistry.js";
import type {
  ReliabilityEvent,
  ReliabilityHealthStatus,
  ReliabilitySubsystemId,
  SubsystemHealthContract,
} from "./reliabilityTypes.js";
import {
  RELIABILITY_HEALTH_STATUSES,
  RELIABILITY_SUBSYSTEM_IDS,
} from "./reliabilityTypes.js";

export function isReliabilitySubsystemId(value: unknown): value is ReliabilitySubsystemId {
  return (
    typeof value === "string" &&
    (RELIABILITY_SUBSYSTEM_IDS as readonly string[]).includes(value)
  );
}

export function isReliabilityHealthStatus(value: unknown): value is ReliabilityHealthStatus {
  return (
    typeof value === "string" &&
    (RELIABILITY_HEALTH_STATUSES as readonly string[]).includes(value)
  );
}

export function validateSubsystemHealthContract(
  contract: SubsystemHealthContract,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isReliabilitySubsystemId(contract.subsystemId)) {
    errors.push("invalid subsystemId");
  }
  if (!isReliabilityHealthStatus(contract.status)) {
    errors.push("invalid status");
  }
  if (!isSubsystemHealthContract(contract)) {
    errors.push("contract missing required fields");
  }
  validateRate(contract.successRate, "successRate", errors);
  validateRate(contract.errorRate, "errorRate", errors);
  if (contract.activeAlerts < 0) errors.push("activeAlerts must be non-negative");
  if (contract.warningCount < 0) errors.push("warningCount must be non-negative");
  if (contract.metrics) {
    for (const [key, value] of Object.entries(contract.metrics)) {
      if (!isReliabilityStandardMetricKey(key)) {
        errors.push(`unknown metric key: ${key}`);
      }
      if (value != null && !Number.isFinite(value)) {
        errors.push(`invalid metric value for ${key}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateReliabilityEvent(
  event: ReliabilityEvent,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isReliabilityEvent(event)) {
    errors.push("event missing required fields");
    return { valid: false, errors };
  }
  if (!isReliabilitySubsystemId(event.subsystem)) errors.push("invalid subsystem");
  if (!isReliabilityEventSeverity(event.severity)) errors.push("invalid severity");
  if (!event.stage.trim()) errors.push("stage is required");
  if (Number.isNaN(Date.parse(event.timestamp))) errors.push("invalid timestamp");
  return { valid: errors.length === 0, errors };
}

export function validateReliabilityFoundation(): { valid: boolean; errors: string[] } {
  const registry = validateReliabilityRegistryIntegrity();
  return registry;
}

function validateRate(value: number | null, field: string, errors: string[]): void {
  if (value == null) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${field} must be null or between 0 and 1`);
  }
}

export { isReliabilityMetricSample };
