import type {
  JourneyReleaseRecommendation,
  JourneyReliabilityReport,
  JourneyRunMode,
  JourneyRunResult,
} from "./journeyTypes.js";
import { JOURNEY_RELIABILITY_VERSION } from "./journeyTypes.js";

export function buildJourneyReliabilityReport(input: {
  mode: JourneyRunMode;
  results: JourneyRunResult[];
  releaseRecommendation: JourneyReleaseRecommendation;
  generatedAt?: string;
  baselineDiff?: JourneyReliabilityReport["baselineDiff"];
}): JourneyReliabilityReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const passed = input.results.filter((r) => r.failures.length === 0).length;
  const failed = input.results.filter((r) => r.failures.length > 0).length;
  const warnings = input.results.filter((r) => r.warnings.length > 0).length;
  const criticalFailures = input.results.filter(
    (r) => r.criticality === "critical" && r.failures.length > 0,
  ).length;

  let failureInjectionPassed = 0;
  let failureInjectionFailed = 0;
  for (const result of input.results) {
    for (const fi of result.failureInjectionResults ?? []) {
      if (fi.passed) failureInjectionPassed += 1;
      else failureInjectionFailed += 1;
    }
  }

  const journeyPassRate =
    input.results.length > 0 ? passed / input.results.length : null;

  const durations = input.results.map((r) => r.processingDurationMs).filter((d) => d > 0);
  const averageProcessingDurationMs =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const scores = input.results
    .map((r) => r.reliabilityScore)
    .filter((s): s is number => s != null);
  const reliabilityScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return {
    schemaVersion: JOURNEY_RELIABILITY_VERSION,
    generatedAt,
    mode: input.mode,
    totals: {
      journeys: input.results.length,
      passed,
      failed,
      warnings,
      criticalFailures,
      failureInjectionPassed,
      failureInjectionFailed,
    },
    journeyPassRate,
    averageProcessingDurationMs,
    reliabilityScore,
    releaseRecommendation: input.releaseRecommendation,
    results: input.results,
    baselineDiff: input.baselineDiff ?? null,
  };
}

export function formatJourneyReliabilityReport(report: JourneyReliabilityReport): string {
  const lines = [
    `Customer Journey Reliability Report (${report.schemaVersion})`,
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Journey pass rate: ${report.journeyPassRate != null ? `${Math.round(report.journeyPassRate * 100)}%` : "n/a"}`,
    `Totals: ${report.totals.passed}/${report.totals.journeys} passed, ${report.totals.failed} failed, ${report.totals.warnings} warnings, ${report.totals.criticalFailures} critical`,
    `Failure injection: ${report.totals.failureInjectionPassed} passed, ${report.totals.failureInjectionFailed} failed`,
    `Avg duration: ${report.averageProcessingDurationMs != null ? `${Math.round(report.averageProcessingDurationMs)}ms` : "n/a"}`,
    `Reliability score: ${report.reliabilityScore ?? "n/a"}`,
    `Release recommendation: ${report.releaseRecommendation.toUpperCase()}`,
    "",
  ];

  for (const result of report.results.filter((r) => !r.passed || r.warnings.length > 0)) {
    lines.push(`Journey ${result.journeyId} [${result.criticality}] (${result.category})`);
    if (result.failures.length > 0) {
      lines.push(`  Failures: ${result.failures.join("; ")}`);
    }
    if (result.warnings.length > 0) {
      lines.push(`  Warnings: ${result.warnings.join("; ")}`);
    }
    lines.push(`  Duration: ${result.processingDurationMs}ms, Score: ${result.reliabilityScore ?? "n/a"}`);
    lines.push("");
  }

  if (report.baselineDiff) {
    lines.push(`Baseline diff (${report.baselineDiff.baselineId}):`);
    lines.push(`  New failures: ${report.baselineDiff.newFailures.join(", ") || "none"}`);
    lines.push(`  Resolved: ${report.baselineDiff.resolvedFailures.join(", ") || "none"}`);
  }

  return lines.join("\n");
}

export function listFailedJourneyLinks(report: JourneyReliabilityReport): Array<{
  journeyId: string;
  criticality: string;
  detailPath: string;
}> {
  return report.results
    .filter((r) => r.failures.length > 0)
    .map((r) => ({
      journeyId: r.journeyId,
      criticality: r.criticality,
      detailPath: `customer-journey-tests/journeys/**/${r.journeyId}.journey.json`,
    }));
}
