import type {
  JourneyBaselineDiff,
  JourneyReleaseRecommendation,
  JourneyRunResult,
  JourneyReliabilityReport,
} from "./journeyTypes.js";

export function classifyJourneyResult(result: JourneyRunResult): "critical_failure" | "failure" | "warning" | "pass" {
  if (result.failures.length === 0 && result.warnings.length === 0) return "pass";
  if (result.criticality === "critical" && result.failures.length > 0) return "critical_failure";
  if (result.failures.length > 0) return "failure";
  return "warning";
}

/**
 * Release gate policy for customer journey reliability.
 */
export function deriveJourneyReleaseRecommendation(input: {
  results: JourneyRunResult[];
  baselineDiff?: JourneyBaselineDiff | null;
}): JourneyReleaseRecommendation {
  const { results, baselineDiff } = input;

  const criticalFailures = results.filter(
    (r) => r.criticality === "critical" && r.failures.length > 0,
  );
  if (criticalFailures.length > 0) return "fail";

  const incorrectPayment = results.filter((r) =>
    r.failures.some((f) => f.includes("persistence") || f.includes("incorrect persistence")),
  );
  if (incorrectPayment.length > 0) return "fail";

  const duplicatePersisted = results.filter((r) =>
    r.tags.includes("duplicate") &&
    r.failures.some((f) => f.includes("duplicate") || f.includes("record count")),
  );
  if (duplicatePersisted.length > 0) return "fail";

  const wrongOrg = results.filter((r) =>
    r.failures.some((f) => f.includes("organization_isolation")),
  );
  if (wrongOrg.length > 0) return "fail";

  const wrongAmount = results.filter((r) =>
    r.failures.some((f) => f.includes("correct_amount") || f.includes("amount expected")),
  );
  if (wrongAmount.length > 0) return "fail";

  const dashboardInconsistency = results.filter((r) =>
    r.failures.some((f) => f.includes("dashboard_state") || f.includes("dashboardVisible")),
  );
  if (dashboardInconsistency.length > 0) return "fail";

  const missingAudit = results.filter((r) =>
    r.failures.some((f) => f.includes("audit_log_present")),
  );
  if (missingAudit.length > 0) return "fail";

  const missingEvents = results.filter((r) =>
    r.failures.some((f) => f.includes("event_emission")),
  );
  if (missingEvents.length > 0) return "fail";

  if (baselineDiff && baselineDiff.newFailures.length > 0) return "fail";

  const warnings = results.filter((r) => r.warnings.length > 0);
  if (warnings.length > 0) return "warn";

  return "pass";
}

export function diffJourneyBaselines(input: {
  baselineId: string;
  previous: JourneyRunResult[];
  current: JourneyRunResult[];
}): JourneyBaselineDiff {
  const prevFailed = new Set(input.previous.filter((r) => !r.passed).map((r) => r.journeyId));
  const currFailed = new Set(input.current.filter((r) => !r.passed).map((r) => r.journeyId));

  const newFailures = [...currFailed].filter((id) => !prevFailed.has(id));
  const resolvedFailures = [...prevFailed].filter((id) => !currFailed.has(id));

  const changedJourneys: JourneyBaselineDiff["changedJourneys"] = [];
  for (const current of input.current) {
    const previous = input.previous.find((r) => r.journeyId === current.journeyId);
    if (!previous) continue;
    if (previous.reliabilityScore !== current.reliabilityScore) {
      changedJourneys.push({
        journeyId: current.journeyId,
        field: "reliabilityScore",
        before: previous.reliabilityScore,
        after: current.reliabilityScore,
      });
    }
  }

  return {
    baselineId: input.baselineId,
    newFailures,
    resolvedFailures,
    changedJourneys,
  };
}

export function buildJourneyRegressionTotals(
  results: JourneyRunResult[],
): JourneyReliabilityReport["totals"] {
  const passed = results.filter((r) => r.failures.length === 0).length;
  const failed = results.filter((r) => r.failures.length > 0).length;
  const warnings = results.filter((r) => r.warnings.length > 0).length;
  const criticalFailures = results.filter(
    (r) => r.criticality === "critical" && r.failures.length > 0,
  ).length;

  let failureInjectionPassed = 0;
  let failureInjectionFailed = 0;
  for (const result of results) {
    for (const fi of result.failureInjectionResults ?? []) {
      if (fi.passed) failureInjectionPassed += 1;
      else failureInjectionFailed += 1;
    }
  }

  return {
    journeys: results.length,
    passed,
    failed,
    warnings,
    criticalFailures,
    failureInjectionPassed,
    failureInjectionFailed,
  };
}
