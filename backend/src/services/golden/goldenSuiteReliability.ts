import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import type { GoldenSuiteCaseResult, GoldenSuiteRegressionReport } from "./goldenSuiteTypes.js";

export const GOLDEN_RELIABILITY_EVENT_TYPES = [
  "golden_case_failed",
  "amount_regression_detected",
  "duplicate_regression_detected",
  "isolation_regression_detected",
  "confidence_drop_detected",
] as const;

export type GoldenReliabilityEventType = (typeof GOLDEN_RELIABILITY_EVENT_TYPES)[number];

export function mapGoldenResultsToReliabilityEvents(
  report: GoldenSuiteRegressionReport,
  organizationId: string | null = null,
): ReliabilityEvent[] {
  const events: ReliabilityEvent[] = [];

  for (const result of report.results) {
    if (result.failures.length === 0 && result.warnings.length === 0) continue;

    const eventType = classifyGoldenReliabilityEventType(result);
    const severity =
      result.criticality === "critical" || eventType !== "confidence_drop_detected"
        ? result.failures.length > 0
          ? "CRITICAL"
          : "WARNING"
        : "WARNING";

    events.push(
      buildReliabilityEvent({
        subsystem: "scanner",
        stage: "decision",
        severity: severity === "CRITICAL" ? "CRITICAL" : result.warnings.length > 0 ? "WARNING" : "IMPORTANT",
        timestamp: report.generatedAt,
        organizationId,
        entityId: result.caseId,
        correlationId: `golden:${eventType}:${result.caseId}`,
        probableRootCause: result.failures[0] ?? result.warnings[0] ?? eventType,
        suggestedAction: "Review golden suite regression before release",
        autoRecoverable: false,
        message: eventType,
      }),
    );
  }

  return events;
}

function classifyGoldenReliabilityEventType(result: GoldenSuiteCaseResult): GoldenReliabilityEventType {
  if (result.changedFields.some((c) => c.field === "amount" && c.classification === "failure")) {
    return "amount_regression_detected";
  }
  if (result.tags.includes("duplicate") && result.failures.length > 0) {
    return "duplicate_regression_detected";
  }
  if (result.tags.includes("isolation") && result.failures.length > 0) {
    return "isolation_regression_detected";
  }
  if (result.changedFields.some((c) => c.field === "confidenceScore")) {
    return "confidence_drop_detected";
  }
  return "golden_case_failed";
}

/**
 * Future Health Dashboard v2 hook — golden suite rollup for scanner panel extension.
 */
export function goldenSuiteHealthExtension(report: GoldenSuiteRegressionReport): {
  goldenPassRate: number | null;
  goldenCriticalFailures: number;
  goldenWarnings: number;
  releaseRecommendation: GoldenSuiteRegressionReport["releaseRecommendation"];
} {
  const { totals } = report;
  return {
    goldenPassRate: totals.cases > 0 ? totals.passed / totals.cases : null,
    goldenCriticalFailures: totals.criticalFailures,
    goldenWarnings: totals.warnings,
    releaseRecommendation: report.releaseRecommendation,
  };
}
