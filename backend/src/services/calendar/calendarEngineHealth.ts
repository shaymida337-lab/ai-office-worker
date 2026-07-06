import type { CalendarEngineOperation, FailureClassification } from "./calendarEngineTypes.js";

export type CalendarHealthSnapshot = {
  lastSuccessfulOperationAt: string | null;
  lastFailureAt: string | null;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageLatencyMs: number | null;
  pendingSyncJobs: number;
  retryCount: number;
  conflictCount: number;
  operationCounts: Record<CalendarEngineOperation, number>;
  generatedAt: string;
};

type MutableHealthState = {
  lastSuccessfulOperationAt: Date | null;
  lastFailureAt: Date | null;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  latencySumMs: number;
  latencyCount: number;
  pendingSyncJobs: number;
  retryCount: number;
  conflictCount: number;
  operationCounts: Record<CalendarEngineOperation, number>;
};

function emptyOperationCounts(): Record<CalendarEngineOperation, number> {
  return {
    create: 0,
    update: 0,
    move: 0,
    cancel: 0,
    delete: 0,
    restore: 0,
    validate: 0,
    detect_conflicts: 0,
  };
}

function createEmptyState(): MutableHealthState {
  return {
    lastSuccessfulOperationAt: null,
    lastFailureAt: null,
    totalOperations: 0,
    successfulOperations: 0,
    failedOperations: 0,
    latencySumMs: 0,
    latencyCount: 0,
    pendingSyncJobs: 0,
    retryCount: 0,
    conflictCount: 0,
    operationCounts: emptyOperationCounts(),
  };
}

const globalHealth = createEmptyState();

export function resetCalendarEngineHealthForTests(): void {
  Object.assign(globalHealth, createEmptyState());
}

export function recordCalendarEngineHealthSuccess(params: {
  operation: CalendarEngineOperation;
  durationMs: number;
}): void {
  globalHealth.totalOperations += 1;
  globalHealth.successfulOperations += 1;
  globalHealth.lastSuccessfulOperationAt = new Date();
  globalHealth.latencySumMs += params.durationMs;
  globalHealth.latencyCount += 1;
  globalHealth.operationCounts[params.operation] += 1;
}

export function recordCalendarEngineHealthFailure(params: {
  operation: CalendarEngineOperation;
  durationMs: number;
  classification: FailureClassification;
}): void {
  globalHealth.totalOperations += 1;
  globalHealth.failedOperations += 1;
  globalHealth.lastFailureAt = new Date();
  globalHealth.latencySumMs += params.durationMs;
  globalHealth.latencyCount += 1;
  globalHealth.operationCounts[params.operation] += 1;
  if (params.classification === "conflict") {
    globalHealth.conflictCount += 1;
  }
  if (params.classification === "transient" || params.classification === "timeout") {
    globalHealth.retryCount += 1;
  }
}

export function incrementCalendarEnginePendingSyncJobs(delta = 1): void {
  globalHealth.pendingSyncJobs = Math.max(0, globalHealth.pendingSyncJobs + delta);
}

export function getCalendarEngineHealthSnapshot(): CalendarHealthSnapshot {
  const averageLatencyMs =
    globalHealth.latencyCount > 0 ? globalHealth.latencySumMs / globalHealth.latencyCount : null;

  return {
    lastSuccessfulOperationAt: globalHealth.lastSuccessfulOperationAt?.toISOString() ?? null,
    lastFailureAt: globalHealth.lastFailureAt?.toISOString() ?? null,
    totalOperations: globalHealth.totalOperations,
    successfulOperations: globalHealth.successfulOperations,
    failedOperations: globalHealth.failedOperations,
    averageLatencyMs,
    pendingSyncJobs: globalHealth.pendingSyncJobs,
    retryCount: globalHealth.retryCount,
    conflictCount: globalHealth.conflictCount,
    operationCounts: { ...globalHealth.operationCounts },
    generatedAt: new Date().toISOString(),
  };
}

export function getCalendarEngineHealthApiResponse(organizationId?: string | null) {
  const health = getCalendarEngineHealthSnapshot();
  return {
    organizationId: organizationId ?? null,
    subsystemId: "calendar" as const,
    health,
    generatedAt: health.generatedAt,
  };
}
