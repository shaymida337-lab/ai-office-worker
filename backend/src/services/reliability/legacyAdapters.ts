import type { SystemComponentStatus } from "../systemHealth.js";
import { buildSubsystemHealthContract } from "./reliabilityHealthContract.js";
import type { ReliabilitySubsystemId, SubsystemHealthContract } from "./reliabilityTypes.js";

const LEGACY_COMPONENT_TO_SUBSYSTEM: Partial<
  Record<SystemComponentStatus["name"] | "database", ReliabilitySubsystemId>
> = {
  gmail: "gmail",
  drive: "drive",
  sheets: "payments",
  whatsapp: "whatsapp",
  database: "dashboard",
};

/**
 * Maps legacy integration health checks to the Natalie reliability health contract
 * without modifying systemHealth.ts behavior.
 */
export function adaptLegacySystemComponentToHealthContract(
  component: SystemComponentStatus,
  checkedAt: string = new Date().toISOString(),
): SubsystemHealthContract | null {
  const subsystemId = LEGACY_COMPONENT_TO_SUBSYSTEM[component.name];
  if (!subsystemId) return null;

  const connected = component.connected && component.status === "PASS";
  return buildSubsystemHealthContract({
    subsystemId,
    status: connected ? "healthy" : component.reason ? "unhealthy" : "not_configured",
    successRate: connected ? 1 : 0,
    errorRate: connected ? 0 : 1,
    activeAlerts: connected ? 0 : 1,
    warningCount: 0,
    summary: component.reason ?? component.label,
    checkedAt,
  });
}

export function adaptLegacySystemHealthResponse(input: {
  checkedAt: string;
  components: Record<string, SystemComponentStatus>;
}): SubsystemHealthContract[] {
  return Object.values(input.components)
    .map((component) => adaptLegacySystemComponentToHealthContract(component, input.checkedAt))
    .filter((contract): contract is SubsystemHealthContract => contract != null);
}
