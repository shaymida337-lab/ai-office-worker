import { buildReliabilityEvent } from "./reliabilityEventModel.js";
import { buildSubsystemHealthContract } from "./reliabilityHealthContract.js";
import { buildReliabilityMetricSample } from "./reliabilityMetrics.js";
import { buildReliabilityDashboardSnapshot } from "./reliabilityDashboard.js";
import { getReliabilityRegistryEntry } from "./reliabilityRegistry.js";
import type {
  ReliabilityDashboardSnapshot,
  ReliabilityDashboardSubsystemPanel,
  ReliabilityEvent,
  ReliabilityMetricSample,
  SubsystemHealthContract,
} from "./reliabilityTypes.js";
import { validateReliabilityEvent, validateSubsystemHealthContract } from "./reliabilityValidation.js";
import type { CalendarHealthSnapshot } from "../calendar/calendarEngineHealth.js";

const CALENDAR_SUBSYSTEM_ID = "calendar" as const;

export type CalendarHealthApiResponse = {
  organizationId: string | null;
  subsystemId: typeof CALENDAR_SUBSYSTEM_ID;
  health: CalendarHealthSnapshot;
  generatedAt: string;
};

export type CalendarReliabilityContribution = {
  subsystemId: typeof CALENDAR_SUBSYSTEM_ID;
  contract: SubsystemHealthContract;
  events: ReliabilityEvent[];
  metricSamples: ReliabilityMetricSample[];
  panel: ReliabilityDashboardSubsystemPanel;
};

function deriveCalendarOperationalStatus(health: CalendarHealthSnapshot): SubsystemHealthContract["status"] {
  if (health.failedOperations > 0 && health.successfulOperations === 0) return "unhealthy";
  if (health.failedOperations > health.successfulOperations * 0.2 && health.totalOperations >= 5) {
    return "degraded";
  }
  if (health.totalOperations === 0) return "unknown";
  return "healthy";
}

export function adaptCalendarHealthToSubsystemContract(
  response: CalendarHealthApiResponse
): SubsystemHealthContract {
  const { health } = response;
  const successRate =
    health.totalOperations > 0 ? health.successfulOperations / health.totalOperations : null;

  return buildSubsystemHealthContract({
    subsystemId: CALENDAR_SUBSYSTEM_ID,
    status: deriveCalendarOperationalStatus(health),
    successRate,
    errorRate: successRate != null ? 1 - successRate : null,
    queueSize: health.pendingSyncJobs,
    retryCount: health.retryCount,
    averageProcessingTimeMs: health.averageLatencyMs,
    lastSuccessfulExecutionAt: health.lastSuccessfulOperationAt,
    lastFailureAt: health.lastFailureAt,
    activeAlerts: health.failedOperations > 0 ? 1 : 0,
    warningCount: health.conflictCount,
    metrics: {
      availability: successRate,
      success_rate: successRate,
      failure_rate: successRate != null ? 1 - successRate : null,
      queue_depth: health.pendingSyncJobs,
      stuck_jobs: 0,
      retry_rate: health.totalOperations > 0 ? health.retryCount / health.totalOperations : null,
      processing_latency: health.averageLatencyMs,
      duplicate_rate: null,
      false_positive_rate: null,
    },
    summary: [
      `ops=${health.totalOperations}`,
      `ok=${health.successfulOperations}`,
      `fail=${health.failedOperations}`,
      `conflicts=${health.conflictCount}`,
      `pending_sync=${health.pendingSyncJobs}`,
    ].join(" "),
    checkedAt: response.generatedAt,
  });
}

export function buildCalendarReliabilityMetricSamples(
  health: CalendarHealthSnapshot,
  recordedAt: string
): ReliabilityMetricSample[] {
  const successRate =
    health.totalOperations > 0 ? health.successfulOperations / health.totalOperations : null;
  return [
    buildReliabilityMetricSample({
      subsystemId: CALENDAR_SUBSYSTEM_ID,
      key: "availability",
      value: successRate,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: CALENDAR_SUBSYSTEM_ID,
      key: "success_rate",
      value: successRate,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: CALENDAR_SUBSYSTEM_ID,
      key: "processing_latency",
      value: health.averageLatencyMs,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: CALENDAR_SUBSYSTEM_ID,
      key: "queue_depth",
      value: health.pendingSyncJobs,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: CALENDAR_SUBSYSTEM_ID,
      key: "retry_rate",
      value: health.totalOperations > 0 ? health.retryCount / health.totalOperations : null,
      recordedAt,
    }),
  ];
}

export function mapCalendarHealthToReliabilityEvents(
  response: CalendarHealthApiResponse
): ReliabilityEvent[] {
  const events: ReliabilityEvent[] = [];
  const { health } = response;
  if (health.lastFailureAt) {
    events.push(
      buildReliabilityEvent({
        subsystem: CALENDAR_SUBSYSTEM_ID,
        stage: "sync",
        severity: "WARNING",
        timestamp: health.lastFailureAt,
        organizationId: response.organizationId,
        correlationId: `calendar:health:failure:${health.lastFailureAt}`,
        message: "calendar_engine_operation_failed",
        probableRootCause: `${health.failedOperations} failed operations recorded`,
        suggestedAction: "Review calendar engine audit logs and conflict metrics",
        autoRecoverable: false,
      })
    );
  }
  if (health.conflictCount > 0) {
    events.push(
      buildReliabilityEvent({
        subsystem: CALENDAR_SUBSYSTEM_ID,
        stage: "decision_queue",
        severity: "INFO",
        timestamp: response.generatedAt,
        organizationId: response.organizationId,
        correlationId: `calendar:health:conflicts:${response.generatedAt}`,
        message: "calendar_conflicts_detected",
        probableRootCause: `${health.conflictCount} conflicts detected`,
        suggestedAction: "Review suggested slots in conflict responses",
        autoRecoverable: true,
      })
    );
  }
  return events;
}

export function buildCalendarReliabilityContribution(
  response: CalendarHealthApiResponse
): CalendarReliabilityContribution {
  const contract = adaptCalendarHealthToSubsystemContract(response);
  const events = mapCalendarHealthToReliabilityEvents(response);
  const metricSamples = buildCalendarReliabilityMetricSamples(response.health, response.generatedAt);
  const registryEntry = getReliabilityRegistryEntry(CALENDAR_SUBSYSTEM_ID);

  const panel: ReliabilityDashboardSubsystemPanel = {
    contract,
    recentEvents: events,
    metricSamples,
    recovery: registryEntry?.recovery ?? {
      subsystemId: CALENDAR_SUBSYSTEM_ID,
      canRetry: true,
      canRestart: true,
      canRequeue: false,
      needsHumanReview: false,
      safeAutomaticRecovery: false,
    },
  };

  return {
    subsystemId: CALENDAR_SUBSYSTEM_ID,
    contract,
    events,
    metricSamples,
    panel,
  };
}

export function mergeCalendarIntoReliabilityDashboard(
  snapshot: ReliabilityDashboardSnapshot,
  calendarPanel: ReliabilityDashboardSubsystemPanel
): ReliabilityDashboardSnapshot {
  const subsystems = snapshot.subsystems.map((panel) =>
    panel.contract.subsystemId === CALENDAR_SUBSYSTEM_ID ? calendarPanel : panel
  );
  const hasCalendar = subsystems.some((panel) => panel.contract.subsystemId === CALENDAR_SUBSYSTEM_ID);
  const mergedSubsystems = hasCalendar ? subsystems : [...subsystems, calendarPanel];
  return buildReliabilityDashboardSnapshot({
    organizationId: snapshot.organizationId,
    generatedAt: snapshot.generatedAt,
    panels: mergedSubsystems,
  });
}

export function buildReliabilityDashboardWithCalendar(
  response: CalendarHealthApiResponse
): ReliabilityDashboardSnapshot {
  const contribution = buildCalendarReliabilityContribution(response);
  const base = buildReliabilityDashboardSnapshot({
    organizationId: response.organizationId,
    generatedAt: response.generatedAt,
  });
  return mergeCalendarIntoReliabilityDashboard(base, contribution.panel);
}

export function validateCalendarReliabilityContribution(
  contribution: CalendarReliabilityContribution
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contractValidation = validateSubsystemHealthContract(contribution.contract);
  if (!contractValidation.valid) errors.push(...contractValidation.errors);
  for (const event of contribution.events) {
    const eventValidation = validateReliabilityEvent(event);
    if (!eventValidation.valid) errors.push(...eventValidation.errors);
  }
  const registryEntry = getReliabilityRegistryEntry(CALENDAR_SUBSYSTEM_ID);
  if (!registryEntry) errors.push("calendar registry entry missing");
  return { valid: errors.length === 0, errors };
}
