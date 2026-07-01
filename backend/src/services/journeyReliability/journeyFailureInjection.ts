import type {
  JourneyActualSnapshot,
  JourneyDefinition,
  JourneyFailureInjectionKind,
  JourneyFailureInjectionResult,
  JourneyFailureScenario,
  JourneyStepResult,
} from "./journeyTypes.js";

export type FailureInjectionContext = {
  journey: JourneyDefinition;
  scenario: JourneyFailureScenario;
  organizationId: string;
};

/**
 * Simulates failure injection outcomes without touching production systems.
 */
export function simulateFailureInjection(
  context: FailureInjectionContext,
  baselineSnapshot: JourneyActualSnapshot,
): {
  snapshot: JourneyActualSnapshot;
  stepResults: JourneyStepResult[];
  injectionResult: JourneyFailureInjectionResult;
} {
  const { scenario, journey } = context;
  const snapshot = applyInjectionEffect(scenario.injection, baselineSnapshot);
  const stepResults = buildInjectedStepResults(journey, scenario);

  const failures: string[] = [];
  const warnings: string[] = [];

  if (scenario.expectedBehavior.noIncorrectPersistence) {
    const incorrect =
      snapshot.recordCount > (journey.expectedOutcome.recordCount ?? 0) &&
      ["not_persisted", "blocked", "rejected"].includes(journey.expectedOutcome.persistenceAction);
    if (incorrect) failures.push("incorrect persistence after injection");
  }

  if (scenario.expectedBehavior.noDataCorruption) {
    if (snapshot.recordCount < 0 || snapshot.auditLogEntries < 0) {
      failures.push("data corruption after injection");
    }
  }

  if (scenario.expectedBehavior.properReviewRouting) {
    if (
      scenario.injection === "claude_timeout" &&
      snapshot.reviewStatus === "auto_saved" &&
      snapshot.persistenceAction === "auto_save_payment"
    ) {
      failures.push("auto-save after claude timeout — should route to review");
    }
  }

  if (scenario.expectedBehavior.reliabilityEventExpected) {
    if (snapshot.reliabilityEventTypes.length === 0) {
      warnings.push("expected reliability event not emitted in simulation");
    }
  }

  if (scenario.expectedBehavior.recoveryPathDeclared && !snapshot.recoveryAutoRecoverable) {
    warnings.push("recovery path not declared in simulation");
  }

  return {
    snapshot,
    stepResults,
    injectionResult: {
      scenarioId: scenario.scenarioId,
      injection: scenario.injection,
      passed: failures.length === 0,
      failures,
      warnings,
    },
  };
}

function applyInjectionEffect(
  injection: JourneyFailureInjectionKind,
  snapshot: JourneyActualSnapshot,
): JourneyActualSnapshot {
  switch (injection) {
    case "claude_timeout":
      return {
        ...snapshot,
        reviewStatus: "needs_review",
        persistenceAction: "needs_review_fdr",
        decisionOutcome: "NEEDS_REVIEW",
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "claude_timeout"],
        recoveryAutoRecoverable: true,
      };
    case "drive_unavailable":
      return {
        ...snapshot,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "drive_unavailable"],
        recoveryAutoRecoverable: true,
      };
    case "ocr_empty":
      return {
        ...snapshot,
        reviewStatus: "needs_review",
        persistenceAction: "needs_review_fdr",
        decisionOutcome: "NEEDS_REVIEW",
        amount: null,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "ocr_empty"],
        recoveryAutoRecoverable: true,
      };
    case "duplicate_document":
      return {
        ...snapshot,
        duplicateDetected: true,
        persistenceAction: "duplicate_update",
        decisionOutcome: "DUPLICATE",
        recordCount: 1,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "duplicate_regression_detected"],
        recoveryAutoRecoverable: false,
      };
    case "corrupted_pdf":
      return {
        ...snapshot,
        reviewStatus: "needs_review",
        persistenceAction: "blocked",
        decisionOutcome: "BLOCKED",
        recordCount: 0,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "corrupted_pdf"],
        recoveryAutoRecoverable: false,
      };
    case "missing_attachment":
      return {
        ...snapshot,
        persistenceAction: "not_persisted",
        decisionOutcome: "NOT_FINANCIAL",
        recordCount: 0,
        dashboardVisible: false,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "missing_attachment"],
        recoveryAutoRecoverable: true,
      };
    case "slow_processing":
      return {
        ...snapshot,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "slow_processing"],
        recoveryAutoRecoverable: true,
      };
    case "network_failure":
      return {
        ...snapshot,
        reviewStatus: "needs_review",
        persistenceAction: "needs_review_fdr",
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "network_failure"],
        recoveryAutoRecoverable: true,
      };
    case "expired_gmail_token":
      return {
        ...snapshot,
        persistenceAction: "none",
        recordCount: 0,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "expired_gmail_token"],
        recoveryAutoRecoverable: true,
      };
    case "expired_whatsapp_session":
      return {
        ...snapshot,
        persistenceAction: "none",
        recordCount: 0,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "expired_whatsapp_session"],
        recoveryAutoRecoverable: true,
      };
    case "permission_denied":
      return {
        ...snapshot,
        persistenceAction: "blocked",
        decisionOutcome: "BLOCKED",
        recordCount: 0,
        reliabilityEventTypes: [...snapshot.reliabilityEventTypes, "permission_denied"],
        recoveryAutoRecoverable: false,
      };
    default:
      return snapshot;
  }
}

function buildInjectedStepResults(
  journey: JourneyDefinition,
  scenario: JourneyFailureScenario,
): JourneyStepResult[] {
  const injectIndex = journey.steps.findIndex((s) => s.stepId === scenario.atStepId);
  return journey.steps.map((step, index) => ({
    stepId: step.stepId,
    kind: step.kind,
    status: index < injectIndex ? "passed" : index === injectIndex ? "failed" : "skipped",
    durationMs: index <= injectIndex ? 50 + index * 10 : 0,
    message: index === injectIndex ? `injected: ${scenario.injection}` : null,
  }));
}

export function listSupportedFailureInjections(): JourneyFailureInjectionKind[] {
  return [
    "claude_timeout",
    "drive_unavailable",
    "ocr_empty",
    "duplicate_document",
    "corrupted_pdf",
    "missing_attachment",
    "slow_processing",
    "network_failure",
    "expired_gmail_token",
    "expired_whatsapp_session",
    "permission_denied",
  ];
}
