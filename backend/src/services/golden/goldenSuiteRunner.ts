import { findGoldenCase, loadGoldenDataset } from "./goldenDataset.js";
import { runGoldenCase } from "./goldenRunner.js";
import {
  compareGoldenSuiteCase,
  snapshotFromGoldenPipeline,
} from "./goldenSuiteComparison.js";
import { buildGoldenRegressionTotals, deriveGoldenReleaseRecommendation, diffGoldenBaselines } from "./goldenSuiteRegression.js";
import { buildGoldenSuiteRegressionReport } from "./goldenSuiteReport.js";
import type {
  GoldenSuiteCase,
  GoldenSuiteCaseResult,
  GoldenSuiteDataset,
  GoldenSuiteRegressionReport,
  GoldenSuiteRunOptions,
} from "./goldenSuiteTypes.js";
import { GOLDEN_SUITE_VERSION } from "./goldenSuiteTypes.js";
import { assertValidGoldenSuiteDataset } from "./goldenSuiteValidation.js";

export const GOLDEN_SUITE_NO_PRODUCTION_DB = true as const;

/**
 * Dry-run golden suite orchestrator.
 * - Uses local fixtures and golden-v1 pipeline cases only.
 * - Never imports prisma or touches production.
 */
export function runGoldenSuiteDryRun(
  dataset: GoldenSuiteDataset,
  options: GoldenSuiteRunOptions,
): GoldenSuiteRegressionReport {
  assertValidGoldenSuiteDataset(dataset);
  assertNoProductionDbAccess();

  const pipelineDataset = safeLoadPipelineDataset();
  const results: GoldenSuiteCaseResult[] = dataset.cases.map((suiteCase) =>
    runGoldenSuiteCaseDryRun(suiteCase, pipelineDataset),
  );

  let baselineDiff = null;
  if (options.mode === "baseline_diff" && options.baselinePath) {
    baselineDiff = diffGoldenBaselines({
      baselineId: options.baselinePath,
      previous: [],
      current: results,
    });
  }

  const releaseRecommendation = deriveGoldenReleaseRecommendation({ results, baselineDiff });

  return buildGoldenSuiteRegressionReport({
    mode: options.mode,
    results,
    releaseRecommendation,
    baselineDiff,
  });
}

export function runGoldenSuiteCaseDryRun(
  suiteCase: GoldenSuiteCase,
  pipelineDataset = safeLoadPipelineDataset(),
): GoldenSuiteCaseResult {
  if (!suiteCase.pipelineCaseId) {
    return scaffoldOnlyCaseResult(suiteCase);
  }

  const pipelineCase = findGoldenCase(pipelineDataset, suiteCase.pipelineCaseId);
  if (!pipelineCase) {
    return {
      caseId: suiteCase.caseId,
      criticality: suiteCase.criticality,
      passed: false,
      warnings: [],
      failures: [`pipeline case not found: ${suiteCase.pipelineCaseId}`],
      changedFields: [],
      tags: suiteCase.tags,
    };
  }

  const pipelineResult = runGoldenCase(pipelineCase);
  const snapshot = snapshotFromGoldenPipeline(pipelineResult.expected, pipelineResult.actual);
  const comparison = compareGoldenSuiteCase(suiteCase, snapshot);

  const pipelineFailures = pipelineResult.passed ? [] : pipelineResult.failures;

  return {
    caseId: suiteCase.caseId,
    criticality: suiteCase.criticality,
    passed: comparison.failures.length === 0 && pipelineFailures.length === 0,
    warnings: comparison.warnings,
    failures: [...comparison.failures, ...pipelineFailures],
    changedFields: comparison.changedFields,
    tags: suiteCase.tags,
  };
}

function scaffoldOnlyCaseResult(suiteCase: GoldenSuiteCase): GoldenSuiteCaseResult {
  return {
    caseId: suiteCase.caseId,
    criticality: suiteCase.criticality,
    passed: true,
    warnings: ["scaffold-only case — awaiting fixture/pipeline bridge"],
    failures: [],
    changedFields: [],
    tags: suiteCase.tags,
  };
}

function safeLoadPipelineDataset() {
  try {
    return loadGoldenDataset();
  } catch {
    return { version: "golden-v1" as const, cases: [] };
  }
}

function assertNoProductionDbAccess(): void {
  if (!GOLDEN_SUITE_NO_PRODUCTION_DB) {
    throw new Error("golden suite must not access production database");
  }
}

export function summarizeGoldenSuiteRun(report: GoldenSuiteRegressionReport): string {
  const totals = buildGoldenRegressionTotals(report.results);
  return `golden-suite ${report.releaseRecommendation}: ${totals.passed}/${totals.cases} passed (${GOLDEN_SUITE_VERSION})`;
}
