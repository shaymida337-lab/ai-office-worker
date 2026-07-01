import { emptySubsystemHealthContract } from "./reliabilityHealthContract.js";
import { listReliabilityRegistryEntries } from "./reliabilityRegistry.js";
import type {
  ReliabilityDashboardRollup,
  ReliabilityDashboardSnapshot,
  ReliabilityDashboardSubsystemPanel,
  ReliabilityEvent,
  SubsystemHealthContract,
} from "./reliabilityTypes.js";
import { RELIABILITY_DASHBOARD_SCHEMA_VERSION } from "./reliabilityTypes.js";

export type BuildReliabilityDashboardInput = {
  organizationId?: string | null;
  generatedAt?: string;
  panels?: ReliabilityDashboardSubsystemPanel[];
};

/**
 * Builds a Health Dashboard v2 snapshot using the shared schema.
 * Default panels use not_configured contracts for every registered subsystem.
 */
export function buildReliabilityDashboardSnapshot(
  input: BuildReliabilityDashboardInput = {},
): ReliabilityDashboardSnapshot {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const panels =
    input.panels ??
    listReliabilityRegistryEntries().map((entry) =>
      buildDefaultSubsystemPanel(entry.id, generatedAt),
    );

  return {
    schemaVersion: RELIABILITY_DASHBOARD_SCHEMA_VERSION,
    generatedAt,
    organizationId: input.organizationId ?? null,
    subsystems: panels,
    rollup: rollupDashboardPanels(panels),
  };
}

export function buildDefaultSubsystemPanel(
  subsystemId: SubsystemHealthContract["subsystemId"],
  checkedAt: string,
): ReliabilityDashboardSubsystemPanel {
  const entry = listReliabilityRegistryEntries().find((row) => row.id === subsystemId);
  return {
    contract: emptySubsystemHealthContract(subsystemId, new Date(checkedAt)),
    recentEvents: [],
    metricSamples: [],
    recovery: entry?.recovery ?? {
      subsystemId,
      canRetry: false,
      canRestart: false,
      canRequeue: false,
      needsHumanReview: true,
      safeAutomaticRecovery: false,
    },
  };
}

export function rollupDashboardPanels(
  panels: ReliabilityDashboardSubsystemPanel[],
): ReliabilityDashboardRollup {
  const rollup: ReliabilityDashboardRollup = {
    totalSubsystems: panels.length,
    healthyCount: 0,
    degradedCount: 0,
    unhealthyCount: 0,
    notConfiguredCount: 0,
    activeAlerts: 0,
    warningCount: 0,
    criticalEventCount: 0,
  };

  for (const panel of panels) {
    switch (panel.contract.status) {
      case "healthy":
        rollup.healthyCount += 1;
        break;
      case "degraded":
        rollup.degradedCount += 1;
        break;
      case "unhealthy":
        rollup.unhealthyCount += 1;
        break;
      case "not_configured":
        rollup.notConfiguredCount += 1;
        break;
      default:
        break;
    }
    rollup.activeAlerts += panel.contract.activeAlerts;
    rollup.warningCount += panel.contract.warningCount;
    rollup.criticalEventCount += countEventsBySeverity(panel.recentEvents, "CRITICAL");
  }

  return rollup;
}

function countEventsBySeverity(
  events: ReliabilityEvent[],
  severity: ReliabilityEvent["severity"],
): number {
  return events.filter((event) => event.severity === severity).length;
}
