import type {
  GoldenReleaseRecommendation,
  GoldenSuiteBaselineDiff,
  GoldenSuiteCaseResult,
  GoldenSuiteRegressionReport,
} from "./goldenSuiteTypes.js";

export type GoldenRegressionClassification = "critical_failure" | "failure" | "warning" | "pass";

export function classifyGoldenCaseResult(result: GoldenSuiteCaseResult): GoldenRegressionClassification {
  if (result.failures.length === 0 && result.warnings.length === 0) return "pass";
  if (result.criticality === "critical" && result.failures.length > 0) return "critical_failure";
  if (result.failures.length > 0) return "failure";
  return "warning";
}

/**
 * Release gate policy — design only, no CI wiring in Phase 1.9.
 */
export function deriveGoldenReleaseRecommendation(input: {
  results: GoldenSuiteCaseResult[];
  baselineDiff?: GoldenSuiteBaselineDiff | null;
}): GoldenReleaseRecommendation {
  const { results, baselineDiff } = input;

  const criticalFailures = results.filter(
    (r) => r.criticality === "critical" && r.failures.length > 0,
  );
  if (criticalFailures.length > 0) return "fail";

  const amountFailures = results.filter((r) =>
    r.changedFields.some((c) => c.field === "amount" && c.classification === "failure"),
  );
  if (amountFailures.length > 0) return "fail";

  const blockedPersistenceFailures = results.filter((r) =>
    r.failures.some((f) => f.includes("persistenceAction") && f.includes("blocked")),
  );
  if (blockedPersistenceFailures.length > 0) return "fail";

  const duplicatePersistenceFailures = results.filter((r) =>
    r.failures.some((f) => f.includes("duplicate") && f.includes("persistence")),
  );
  if (duplicatePersistenceFailures.length > 0) return "fail";

  const isolationFailures = results.filter((r) =>
    r.tags.includes("isolation") && r.failures.length > 0,
  );
  if (isolationFailures.length > 0) return "fail";

  const autoSaveRegression = results.filter((r) =>
    r.changedFields.some(
      (c) =>
        c.field === "reviewStatus" &&
        String(c.expected) === "needs_review" &&
        String(c.actual) === "auto_saved",
    ),
  );
  if (autoSaveRegression.length > 0) return "fail";

  if (baselineDiff && baselineDiff.newFailures.length > 0) return "fail";

  const warnings = results.filter((r) => r.warnings.length > 0);
  if (warnings.length > 0) return "warn";

  return "pass";
}

export function buildGoldenRegressionTotals(
  results: GoldenSuiteCaseResult[],
): GoldenSuiteRegressionReport["totals"] {
  const passed = results.filter((r) => r.failures.length === 0).length;
  const failed = results.filter((r) => r.failures.length > 0).length;
  const warnings = results.filter((r) => r.warnings.length > 0).length;
  const criticalFailures = results.filter(
    (r) => r.criticality === "critical" && r.failures.length > 0,
  ).length;

  return {
    cases: results.length,
    passed,
    failed,
    warnings,
    criticalFailures,
  };
}

export function diffGoldenBaselines(input: {
  baselineId: string;
  previous: GoldenSuiteCaseResult[];
  current: GoldenSuiteCaseResult[];
}): GoldenSuiteBaselineDiff {
  const prevFailed = new Set(input.previous.filter((r) => !r.passed).map((r) => r.caseId));
  const currFailed = new Set(input.current.filter((r) => !r.passed).map((r) => r.caseId));

  const newFailures = [...currFailed].filter((id) => !prevFailed.has(id));
  const resolvedFailures = [...prevFailed].filter((id) => !currFailed.has(id));

  const changedFields: GoldenSuiteBaselineDiff["changedFields"] = [];
  for (const current of input.current) {
    const previous = input.previous.find((r) => r.caseId === current.caseId);
    if (!previous) continue;
    for (const change of current.changedFields) {
      const prior = previous.changedFields.find((c) => c.field === change.field);
      if (!prior || prior.actual !== change.actual) {
        changedFields.push({
          caseId: current.caseId,
          field: change.field,
          before: prior?.actual ?? null,
          after: change.actual,
        });
      }
    }
  }

  return {
    baselineId: input.baselineId,
    newFailures,
    resolvedFailures,
    changedFields,
  };
}
