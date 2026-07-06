import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptCalendarHealthToSubsystemContract,
  buildCalendarReliabilityContribution,
  validateCalendarReliabilityContribution,
} from "./calendarReliabilityAdapter.js";
import type { CalendarHealthApiResponse } from "./calendarReliabilityAdapter.js";

const GENERATED_AT = "2026-07-06T18:00:00.000Z";

function sampleHealthResponse(overrides?: Partial<CalendarHealthApiResponse["health"]>): CalendarHealthApiResponse {
  return {
    organizationId: "org-1",
    subsystemId: "calendar",
    generatedAt: GENERATED_AT,
    health: {
      lastSuccessfulOperationAt: GENERATED_AT,
      lastFailureAt: null,
      totalOperations: 10,
      successfulOperations: 9,
      failedOperations: 1,
      averageLatencyMs: 150,
      pendingSyncJobs: 0,
      retryCount: 1,
      conflictCount: 2,
      operationCounts: {
        create: 4,
        update: 2,
        move: 1,
        cancel: 1,
        delete: 0,
        restore: 0,
        validate: 1,
        detect_conflicts: 1,
      },
      generatedAt: GENERATED_AT,
      ...overrides,
    },
  };
}

test("adaptCalendarHealthToSubsystemContract maps engine health to reliability contract", () => {
  const contract = adaptCalendarHealthToSubsystemContract(sampleHealthResponse());
  assert.equal(contract.subsystemId, "calendar");
  assert.equal(contract.status, "healthy");
  assert.equal(contract.successRate, 0.9);
  assert.equal(contract.metrics.processing_latency, 150);
  assert.equal(contract.warningCount, 2);
});

test("buildCalendarReliabilityContribution produces valid dashboard panel", () => {
  const contribution = buildCalendarReliabilityContribution(
    sampleHealthResponse({ failedOperations: 3, successfulOperations: 0, totalOperations: 3 })
  );
  assert.equal(contribution.subsystemId, "calendar");
  assert.equal(contribution.contract.status, "unhealthy");
  assert.ok(contribution.metricSamples.length >= 3);
  const validation = validateCalendarReliabilityContribution(contribution);
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("calendar reliability contribution emits conflict events", () => {
  const contribution = buildCalendarReliabilityContribution(sampleHealthResponse());
  assert.ok(contribution.events.some((event) => event.message === "calendar_conflicts_detected"));
});
