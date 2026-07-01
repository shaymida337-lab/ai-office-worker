import type {
  JourneyActualSnapshot,
  JourneyDefinition,
  JourneyExpectedOutcome,
  JourneyStepResult,
} from "./journeyTypes.js";

/**
 * Validation engine — compares journey expected outcome vs simulated actual snapshot.
 * Phase 2.0: simulation only; Phase 2.1+ will wire real pipeline adapters.
 */
export function buildSimulatedSnapshot(
  journey: JourneyDefinition,
  organizationId = "org-journey-sim-001",
): JourneyActualSnapshot {
  const expected = journey.expectedOutcome;
  return {
    persistenceAction: expected.persistenceAction,
    reviewStatus: expected.reviewStatus,
    decisionOutcome: expected.decisionOutcome,
    dashboardVisible: expected.dashboardVisible,
    supplierName: expected.supplierName ?? null,
    amount: expected.amount ?? null,
    currency: expected.currency ?? null,
    paymentDirection: expected.paymentDirection ?? null,
    fingerprint: expected.fingerprint ?? `fp-${journey.journeyId}`,
    documentType: expected.documentType ?? null,
    recordCount: expected.recordCount ?? 0,
    auditLogEntries: expected.auditLogEntries ?? 0,
    reliabilityEventTypes: expected.reliabilityEventTypes ?? [],
    notificationSent: expected.notificationSent ?? false,
    recoveryAutoRecoverable: expected.recoveryAutoRecoverable ?? false,
    organizationId,
    duplicateDetected: expected.decisionOutcome === "DUPLICATE",
  };
}

export function simulateJourneySteps(journey: JourneyDefinition): JourneyStepResult[] {
  return journey.steps.map((step, index) => ({
    stepId: step.stepId,
    kind: step.kind,
    status: journey.scaffoldOnly ? "simulated" : "passed",
    durationMs: 25 + index * 15,
    message: journey.scaffoldOnly ? "scaffold-only step" : null,
  }));
}

export function compareJourneyOutcome(
  expected: JourneyExpectedOutcome,
  actual: JourneyActualSnapshot,
): string[] {
  const failures: string[] = [];

  if (expected.persistenceAction !== actual.persistenceAction) {
    failures.push(
      `persistenceAction expected ${expected.persistenceAction} got ${actual.persistenceAction}`,
    );
  }
  if (expected.reviewStatus !== actual.reviewStatus) {
    failures.push(`reviewStatus expected ${expected.reviewStatus} got ${actual.reviewStatus}`);
  }
  if (expected.decisionOutcome !== actual.decisionOutcome) {
    failures.push(`decisionOutcome expected ${expected.decisionOutcome} got ${actual.decisionOutcome}`);
  }
  if (expected.dashboardVisible !== actual.dashboardVisible) {
    failures.push(
      `dashboardVisible expected ${expected.dashboardVisible} got ${actual.dashboardVisible}`,
    );
  }
  if (expected.amount !== undefined && expected.amount !== actual.amount) {
    failures.push(`amount expected ${expected.amount} got ${actual.amount}`);
  }
  if (expected.supplierName !== undefined && expected.supplierName !== actual.supplierName) {
    failures.push(`supplierName expected ${expected.supplierName} got ${actual.supplierName}`);
  }
  if (expected.recordCount !== undefined && expected.recordCount !== actual.recordCount) {
    failures.push(`recordCount expected ${expected.recordCount} got ${actual.recordCount}`);
  }

  return failures;
}

export function computeJourneyReliabilityScore(input: {
  assertionPassRate: number;
  stepPassRate: number;
  failureInjectionPassRate: number | null;
}): number {
  const fi = input.failureInjectionPassRate ?? 1;
  return Math.round(((input.assertionPassRate + input.stepPassRate + fi) / 3) * 100) / 100;
}
