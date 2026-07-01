import type {
  GoldenReleaseRecommendation,
  GoldenSuiteCaseResult,
  GoldenSuiteRegressionReport,
  GoldenSuiteRunMode,
} from "./goldenSuiteTypes.js";
import { GOLDEN_SUITE_VERSION } from "./goldenSuiteTypes.js";

export function buildGoldenSuiteRegressionReport(input: {
  mode: GoldenSuiteRunMode;
  results: GoldenSuiteCaseResult[];
  releaseRecommendation: GoldenReleaseRecommendation;
  generatedAt?: string;
  baselineDiff?: GoldenSuiteRegressionReport["baselineDiff"];
}): GoldenSuiteRegressionReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const passed = input.results.filter((r) => r.failures.length === 0).length;
  const failed = input.results.filter((r) => r.failures.length > 0).length;
  const warnings = input.results.filter((r) => r.warnings.length > 0).length;
  const criticalFailures = input.results.filter(
    (r) => r.criticality === "critical" && r.failures.length > 0,
  ).length;

  return {
    schemaVersion: GOLDEN_SUITE_VERSION,
    generatedAt,
    mode: input.mode,
    totals: {
      cases: input.results.length,
      passed,
      failed,
      warnings,
      criticalFailures,
    },
    releaseRecommendation: input.releaseRecommendation,
    results: input.results,
    baselineDiff: input.baselineDiff ?? null,
  };
}

export function formatGoldenSuiteRegressionReport(report: GoldenSuiteRegressionReport): string {
  const lines = [
    `Golden Suite Report (${report.schemaVersion})`,
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Totals: ${report.totals.passed}/${report.totals.cases} passed, ${report.totals.failed} failed, ${report.totals.warnings} warnings, ${report.totals.criticalFailures} critical`,
    `Release recommendation: ${report.releaseRecommendation.toUpperCase()}`,
    "",
  ];

  for (const result of report.results.filter((r) => !r.passed || r.warnings.length > 0)) {
    lines.push(`Case ${result.caseId} [${result.criticality}]`);
    if (result.failures.length > 0) {
      lines.push(`  Failures: ${result.failures.join("; ")}`);
    }
    if (result.warnings.length > 0) {
      lines.push(`  Warnings: ${result.warnings.join("; ")}`);
    }
    for (const change of result.changedFields) {
      lines.push(
        `  Changed ${change.field}: ${JSON.stringify(change.expected)} -> ${JSON.stringify(change.actual)} (${change.classification})`,
      );
    }
    lines.push("");
  }

  if (report.baselineDiff) {
    lines.push(`Baseline diff (${report.baselineDiff.baselineId}):`);
    lines.push(`  New failures: ${report.baselineDiff.newFailures.join(", ") || "none"}`);
    lines.push(`  Resolved: ${report.baselineDiff.resolvedFailures.join(", ") || "none"}`);
  }

  return lines.join("\n");
}

export function listFailedCaseLinks(report: GoldenSuiteRegressionReport): Array<{
  caseId: string;
  criticality: string;
  detailPath: string;
}> {
  return report.results
    .filter((r) => r.failures.length > 0)
    .map((r) => ({
      caseId: r.caseId,
      criticality: r.criticality,
      detailPath: `golden-tests/cases/**/${r.caseId}.golden.json`,
    }));
}
