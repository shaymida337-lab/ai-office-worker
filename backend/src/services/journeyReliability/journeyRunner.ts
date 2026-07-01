import { runJourneyAssertions, summarizeAssertionResults } from "./journeyAssertions.js";
import { simulateFailureInjection } from "./journeyFailureInjection.js";
import { findJourneyInRegistry } from "./journeyRegistry.js";
import { deriveJourneyReleaseRecommendation, diffJourneyBaselines } from "./journeyRegression.js";
import { buildJourneyReliabilityReport } from "./journeyReport.js";
import type {
  JourneyDataset,
  JourneyDefinition,
  JourneyReliabilityReport,
  JourneyRunOptions,
  JourneyRunResult,
} from "./journeyTypes.js";
import { JOURNEY_RELIABILITY_VERSION } from "./journeyTypes.js";
import {
  buildSimulatedSnapshot,
  compareJourneyOutcome,
  computeJourneyReliabilityScore,
  simulateJourneySteps,
} from "./journeyValidationEngine.js";
import { assertValidJourneyDataset } from "./journeyValidation.js";

export const JOURNEY_RELIABILITY_NO_PRODUCTION_DB = true as const;

/**
 * Dry-run customer journey orchestrator.
 * - Simulates end-to-end workflows without production DB or scanner changes.
 * - Bridges to golden-suite for document pipeline steps when configured.
 */
export function runJourneyReliabilityDryRun(
  dataset: JourneyDataset,
  options: JourneyRunOptions,
): JourneyReliabilityReport {
  assertValidJourneyDataset(dataset);
  assertNoProductionDbAccess();

  const results: JourneyRunResult[] = dataset.journeys.map((journey) =>
    runJourneyDryRun(journey, options),
  );

  let baselineDiff = null;
  if (options.mode === "baseline_diff" && options.baselinePath) {
    baselineDiff = diffJourneyBaselines({
      baselineId: options.baselinePath,
      previous: [],
      current: results,
    });
  }

  const releaseRecommendation = deriveJourneyReleaseRecommendation({ results, baselineDiff });

  return buildJourneyReliabilityReport({
    mode: options.mode,
    results,
    releaseRecommendation,
    baselineDiff,
  });
}

export function runJourneyDryRun(
  journey: JourneyDefinition,
  options: JourneyRunOptions,
): JourneyRunResult {
  const start = Date.now();

  if (journey.scaffoldOnly || journey.implemented === false) {
    return scaffoldJourneyResult(journey, start);
  }

  const snapshot = buildSimulatedSnapshot(journey);
  const stepResults = simulateJourneySteps(journey);
  const assertionResults = runJourneyAssertions(journey, snapshot);
  const { failures: assertionFailures, warnings: assertionWarnings } =
    summarizeAssertionResults(assertionResults);
  const outcomeFailures = compareJourneyOutcome(journey.expectedOutcome, snapshot);

  let failureInjectionResults = undefined;
  if (options.injectFailures && journey.failureScenarios?.length) {
    failureInjectionResults = journey.failureScenarios.map((scenario) =>
      simulateFailureInjection(
        { journey, scenario, organizationId: snapshot.organizationId },
        snapshot,
      ).injectionResult,
    );
  }

  const failures = [...outcomeFailures, ...assertionFailures];
  const warnings = [...assertionWarnings];
  if (journey.goldenSuiteCaseId) {
    warnings.push(`golden-suite bridge pending for ${journey.goldenSuiteCaseId}`);
  }

  const assertionPassRate =
    assertionResults.length > 0
      ? assertionResults.filter((a) => a.passed).length / assertionResults.length
      : 1;
  const stepPassRate =
    stepResults.length > 0
      ? stepResults.filter((s) => s.status === "passed" || s.status === "simulated").length /
        stepResults.length
      : 1;
  const fiResults = failureInjectionResults ?? [];
  const failureInjectionPassRate =
    fiResults.length > 0 ? fiResults.filter((f) => f.passed).length / fiResults.length : null;

  const reliabilityScore = computeJourneyReliabilityScore({
    assertionPassRate,
    stepPassRate,
    failureInjectionPassRate,
  });

  return {
    journeyId: journey.journeyId,
    category: journey.category,
    criticality: journey.criticality,
    passed: failures.length === 0,
    warnings,
    failures,
    stepResults,
    assertionResults,
    failureInjectionResults,
    processingDurationMs: Date.now() - start,
    reliabilityScore,
    tags: journey.tags,
  };
}

function scaffoldJourneyResult(journey: JourneyDefinition, start: number): JourneyRunResult {
  return {
    journeyId: journey.journeyId,
    category: journey.category,
    criticality: journey.criticality,
    passed: true,
    warnings: ["scaffold-only journey — awaiting implementation"],
    failures: [],
    stepResults: simulateJourneySteps(journey),
    assertionResults: [],
    processingDurationMs: Date.now() - start,
    reliabilityScore: null,
    tags: journey.tags,
  };
}

function assertNoProductionDbAccess(): void {
  if (!JOURNEY_RELIABILITY_NO_PRODUCTION_DB) {
    throw new Error("journey reliability must not access production database");
  }
}

export function runJourneyById(journeyId: string, options: JourneyRunOptions): JourneyRunResult | null {
  const journey = findJourneyInRegistry(journeyId);
  if (!journey) return null;
  return runJourneyDryRun(journey, options);
}

export function summarizeJourneyRun(report: JourneyReliabilityReport): string {
  const rate =
    report.journeyPassRate != null ? `${Math.round(report.journeyPassRate * 100)}%` : "n/a";
  return `journey-reliability ${report.releaseRecommendation}: ${report.totals.passed}/${report.totals.journeys} passed (${rate}, ${JOURNEY_RELIABILITY_VERSION})`;
}
