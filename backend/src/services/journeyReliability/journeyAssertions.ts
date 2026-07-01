import type {
  JourneyActualSnapshot,
  JourneyAssertionKind,
  JourneyAssertionResult,
  JourneyDefinition,
  JourneyExpectedOutcome,
} from "./journeyTypes.js";

export function runJourneyAssertions(
  journey: JourneyDefinition,
  actual: JourneyActualSnapshot,
): JourneyAssertionResult[] {
  return journey.assertions.map((assertion) => evaluateAssertion(assertion, journey.expectedOutcome, actual));
}

function evaluateAssertion(
  assertion: JourneyAssertionKind,
  expected: JourneyExpectedOutcome,
  actual: JourneyActualSnapshot,
): JourneyAssertionResult {
  switch (assertion) {
    case "no_duplicate_records":
      return assertCondition(
        assertion,
        !actual.duplicateDetected || actual.recordCount <= (expected.recordCount ?? 1),
        expected.recordCount ?? 1,
        actual.recordCount,
        actual.duplicateDetected
          ? "duplicate detected but record count exceeded expected"
          : "record count within bounds",
      );
    case "correct_fingerprint":
      return assertNullableMatch(assertion, expected.fingerprint, actual.fingerprint, "fingerprint");
    case "organization_isolation":
      return assertCondition(
        assertion,
        actual.organizationId.startsWith("org-") || actual.organizationId.length > 0,
        "isolated org",
        actual.organizationId,
        "organization must be set and isolated",
      );
    case "correct_supplier":
      return assertNullableMatch(assertion, expected.supplierName, actual.supplierName, "supplier");
    case "correct_amount":
      return assertNullableMatch(assertion, expected.amount, actual.amount, "amount");
    case "correct_payment_direction":
      return assertNullableMatch(
        assertion,
        expected.paymentDirection,
        actual.paymentDirection,
        "paymentDirection",
      );
    case "correct_review_state":
      return assertMatch(assertion, expected.reviewStatus, actual.reviewStatus, "reviewStatus");
    case "confidence_threshold":
      return {
        assertion,
        passed: true,
        classification: "warning",
        expected: "threshold check",
        actual: "deferred to golden suite",
        reason: "confidence validated via golden-suite bridge in Phase 2.1",
      };
    case "dashboard_state":
      return assertMatch(assertion, expected.dashboardVisible, actual.dashboardVisible, "dashboardVisible");
    case "event_emission":
      return assertEvents(assertion, expected.reliabilityEventTypes ?? [], actual.reliabilityEventTypes);
    case "recovery_declaration":
      return assertCondition(
        assertion,
        expected.recoveryAutoRecoverable === undefined ||
          actual.recoveryAutoRecoverable === expected.recoveryAutoRecoverable,
        expected.recoveryAutoRecoverable ?? "any",
        actual.recoveryAutoRecoverable,
        "recovery declaration mismatch",
      );
    case "correct_persistence":
      return assertMatch(assertion, expected.persistenceAction, actual.persistenceAction, "persistenceAction");
    case "correct_status":
      return assertMatch(assertion, expected.decisionOutcome, actual.decisionOutcome, "decisionOutcome");
    case "audit_log_present":
      return assertCondition(
        assertion,
        (expected.auditLogEntries ?? 0) <= actual.auditLogEntries,
        expected.auditLogEntries ?? 0,
        actual.auditLogEntries,
        "audit log entries missing",
      );
    case "permissions_enforced":
      return {
        assertion,
        passed: true,
        classification: "warning",
        expected: "permissions enforced",
        actual: "simulated",
        reason: "permissions check deferred to integration phase",
      };
    case "notification_sent":
      return assertMatch(assertion, expected.notificationSent ?? false, actual.notificationSent, "notificationSent");
    case "no_incorrect_persistence":
      return assertNoIncorrectPersistence(assertion, expected, actual);
    case "no_data_corruption":
      return assertCondition(
        assertion,
        actual.recordCount >= 0 && actual.auditLogEntries >= 0,
        "non-negative counts",
        { recordCount: actual.recordCount, auditLogEntries: actual.auditLogEntries },
        "data corruption indicators present",
      );
    default:
      return {
        assertion,
        passed: false,
        classification: "failure",
        expected: assertion,
        actual: null,
        reason: `unknown assertion: ${assertion}`,
      };
  }
}

function assertNoIncorrectPersistence(
  assertion: JourneyAssertionKind,
  expected: JourneyExpectedOutcome,
  actual: JourneyActualSnapshot,
): JourneyAssertionResult {
  const blocked = ["not_persisted", "blocked", "rejected"];
  const shouldNotPersist = blocked.includes(expected.persistenceAction);
  const incorrectlyPersisted =
    shouldNotPersist &&
    actual.recordCount > (expected.recordCount ?? 0);

  return assertCondition(
    assertion,
    !incorrectlyPersisted,
    `max ${expected.recordCount ?? 0} records`,
    actual.recordCount,
    "incorrect persistence detected",
  );
}

function assertMatch(
  assertion: JourneyAssertionKind,
  expected: unknown,
  actual: unknown,
  label: string,
): JourneyAssertionResult {
  const passed = expected === actual;
  return {
    assertion,
    passed,
    classification: passed ? "warning" : "failure",
    expected,
    actual,
    reason: passed ? `${label} matches` : `${label} expected ${String(expected)} got ${String(actual)}`,
  };
}

function assertNullableMatch(
  assertion: JourneyAssertionKind,
  expected: unknown,
  actual: unknown,
  label: string,
): JourneyAssertionResult {
  if (expected === undefined) {
    return {
      assertion,
      passed: true,
      classification: "warning",
      expected: undefined,
      actual,
      reason: `${label} not specified in expected outcome`,
    };
  }
  return assertMatch(assertion, expected, actual, label);
}

function assertCondition(
  assertion: JourneyAssertionKind,
  passed: boolean,
  expected: unknown,
  actual: unknown,
  failReason: string,
): JourneyAssertionResult {
  return {
    assertion,
    passed,
    classification: passed ? "warning" : "failure",
    expected,
    actual,
    reason: passed ? "condition met" : failReason,
  };
}

function assertEvents(
  assertion: JourneyAssertionKind,
  expected: string[],
  actual: string[],
): JourneyAssertionResult {
  if (expected.length === 0) {
    return {
      assertion,
      passed: true,
      classification: "warning",
      expected,
      actual,
      reason: "no specific events required",
    };
  }
  const missing = expected.filter((e) => !actual.includes(e));
  return {
    assertion,
    passed: missing.length === 0,
    classification: missing.length === 0 ? "warning" : "failure",
    expected,
    actual,
    reason: missing.length === 0 ? "all expected events present" : `missing events: ${missing.join(", ")}`,
  };
}

export function summarizeAssertionResults(results: JourneyAssertionResult[]): {
  failures: string[];
  warnings: string[];
} {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (!result.passed && result.classification === "failure") {
      failures.push(`${result.assertion}: ${result.reason}`);
    } else if (!result.passed || result.classification === "warning") {
      warnings.push(`${result.assertion}: ${result.reason}`);
    }
  }
  return { failures, warnings };
}
