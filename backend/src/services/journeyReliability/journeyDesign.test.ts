import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJourneyAssertions, summarizeAssertionResults } from "./journeyAssertions.js";
import { simulateFailureInjection, listSupportedFailureInjections } from "./journeyFailureInjection.js";
import {
  JOURNEY_REGISTRY,
  buildJourneyDatasetFromRegistry,
  findJourneyInRegistry,
  listCriticalJourneys,
  listImplementedJourneys,
} from "./journeyRegistry.js";
import {
  classifyJourneyResult,
  deriveJourneyReleaseRecommendation,
  diffJourneyBaselines,
} from "./journeyRegression.js";
import {
  buildJourneyReliabilityReport,
  formatJourneyReliabilityReport,
  listFailedJourneyLinks,
} from "./journeyReport.js";
import {
  JOURNEY_RELIABILITY_EVENT_TYPES,
  bridgeGoldenSuiteToJourney,
  journeyReliabilityHealthExtension,
  mapJourneyResultsToReliabilityEvents,
} from "./journeyReliabilityIntegration.js";
import {
  JOURNEY_RELIABILITY_NO_PRODUCTION_DB,
  runJourneyDryRun,
  runJourneyReliabilityDryRun,
} from "./journeyRunner.js";
import type { JourneyDefinition, JourneyRunResult } from "./journeyTypes.js";
import { JOURNEY_RELIABILITY_VERSION } from "./journeyTypes.js";
import {
  buildSimulatedSnapshot,
  compareJourneyOutcome,
  computeJourneyReliabilityScore,
} from "./journeyValidationEngine.js";
import {
  assertValidJourneyDataset,
  validateFailureScenarioStepRefs,
  validateJourneyDataset,
} from "./journeyValidation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, "fixtures");

function loadExampleJourney(): JourneyDefinition {
  const raw = readFileSync(join(FIXTURE_ROOT, "example-journey.json"), "utf8");
  return JSON.parse(raw) as JourneyDefinition;
}

test("journey: registry contains all categories", () => {
  const categories = new Set(JOURNEY_REGISTRY.map((j) => j.category));
  assert.ok(categories.has("financial_documents"));
  assert.ok(categories.has("whatsapp"));
  assert.ok(categories.has("manual_upload"));
  assert.ok(categories.has("calendar"));
  assert.ok(categories.has("tasks"));
  assert.ok(categories.has("payments"));
});

test("journey: validates registry dataset schema", () => {
  const dataset = buildJourneyDatasetFromRegistry();
  const issues = validateJourneyDataset(dataset);
  assert.deepEqual(issues, []);
  assert.doesNotThrow(() => assertValidJourneyDataset(dataset));
});

test("journey: failure scenario step refs are valid", () => {
  for (const journey of JOURNEY_REGISTRY) {
    const issues = validateFailureScenarioStepRefs(journey);
    assert.deepEqual(issues, [], `journey ${journey.journeyId} has invalid failure scenario refs`);
  }
});

test("journey: assertions pass on simulated happy path", () => {
  const journey = findJourneyInRegistry("cj-fin-001-gmail-invoice-to-payment");
  assert.ok(journey);
  const snapshot = buildSimulatedSnapshot(journey!);
  const results = runJourneyAssertions(journey!, snapshot);
  const { failures } = summarizeAssertionResults(results);
  assert.equal(failures.length, 0);
});

test("journey: outcome comparison detects amount mismatch", () => {
  const journey = findJourneyInRegistry("cj-fin-001-gmail-invoice-to-payment");
  assert.ok(journey);
  const snapshot = buildSimulatedSnapshot(journey!);
  snapshot.amount = 999;
  const failures = compareJourneyOutcome(journey!.expectedOutcome, snapshot);
  assert.ok(failures.some((f) => f.includes("amount")));
});

test("journey: failure injection — claude timeout routes to review", () => {
  const journey = findJourneyInRegistry("cj-fin-001-gmail-invoice-to-payment");
  assert.ok(journey);
  const scenario = journey!.failureScenarios!.find((s) => s.injection === "claude_timeout");
  assert.ok(scenario);
  const baseline = buildSimulatedSnapshot(journey!);
  const { snapshot, injectionResult } = simulateFailureInjection(
    { journey: journey!, scenario: scenario!, organizationId: baseline.organizationId },
    baseline,
  );
  assert.equal(snapshot.reviewStatus, "needs_review");
  assert.equal(snapshot.persistenceAction, "needs_review_fdr");
  assert.equal(injectionResult.passed, true);
});

test("journey: failure injection — duplicate prevents new persistence", () => {
  const journey = findJourneyInRegistry("cj-fin-004-duplicate-no-persistence");
  assert.ok(journey);
  const scenario = journey!.failureScenarios![0];
  const baseline = buildSimulatedSnapshot(journey!);
  const { snapshot } = simulateFailureInjection(
    { journey: journey!, scenario, organizationId: baseline.organizationId },
    baseline,
  );
  assert.equal(snapshot.duplicateDetected, true);
  assert.equal(snapshot.recordCount, 1);
});

test("journey: all failure injection kinds supported", () => {
  const supported = listSupportedFailureInjections();
  assert.equal(supported.length, 11);
});

test("journey: release gates fail on critical journey failure", () => {
  const failResult: JourneyRunResult = {
    journeyId: "cj-test",
    category: "financial_documents",
    criticality: "critical",
    passed: false,
    warnings: [],
    failures: ["correct_persistence: mismatch"],
    stepResults: [],
    assertionResults: [],
    processingDurationMs: 100,
    reliabilityScore: 0.5,
    tags: [],
  };
  assert.equal(classifyJourneyResult(failResult), "critical_failure");
  assert.equal(deriveJourneyReleaseRecommendation({ results: [failResult] }), "fail");
});

test("journey: release gates warn on warnings only", () => {
  const warnResult: JourneyRunResult = {
    journeyId: "cj-warn",
    category: "tasks",
    criticality: "standard",
    passed: true,
    warnings: ["scaffold-only"],
    failures: [],
    stepResults: [],
    assertionResults: [],
    processingDurationMs: 50,
    reliabilityScore: 1,
    tags: [],
  };
  assert.equal(deriveJourneyReleaseRecommendation({ results: [warnResult] }), "warn");
});

test("journey: baseline diff detects new failures", () => {
  const previous: JourneyRunResult[] = [
    {
      journeyId: "a",
      category: "tasks",
      criticality: "standard",
      passed: true,
      warnings: [],
      failures: [],
      stepResults: [],
      assertionResults: [],
      processingDurationMs: 10,
      reliabilityScore: 1,
      tags: [],
    },
  ];
  const current: JourneyRunResult[] = [
    {
      journeyId: "a",
      category: "tasks",
      criticality: "standard",
      passed: false,
      warnings: [],
      failures: ["regression"],
      stepResults: [],
      assertionResults: [],
      processingDurationMs: 10,
      reliabilityScore: 0.5,
      tags: [],
    },
  ];
  const diff = diffJourneyBaselines({ baselineId: "ci", previous, current });
  assert.deepEqual(diff.newFailures, ["a"]);
});

test("journey: report generation includes pass rate and duration", () => {
  const report = buildJourneyReliabilityReport({
    mode: "dry_run",
    results: [
      {
        journeyId: "cj-fin-001-gmail-invoice-to-payment",
        category: "financial_documents",
        criticality: "critical",
        passed: true,
        warnings: [],
        failures: [],
        stepResults: [],
        assertionResults: [],
        processingDurationMs: 200,
        reliabilityScore: 0.95,
        tags: [],
      },
    ],
    releaseRecommendation: "pass",
    generatedAt: "2026-07-01T14:00:00.000Z",
  });
  assert.equal(report.journeyPassRate, 1);
  assert.equal(report.averageProcessingDurationMs, 200);
  const text = formatJourneyReliabilityReport(report);
  assert.match(text, /Release recommendation: PASS/);
});

test("journey: reliability event mapping", () => {
  const report = buildJourneyReliabilityReport({
    mode: "dry_run",
    results: [
      {
        journeyId: "cj-fin-004-duplicate-no-persistence",
        category: "financial_documents",
        criticality: "critical",
        passed: false,
        warnings: [],
        failures: ["no_duplicate_records: exceeded"],
        stepResults: [],
        assertionResults: [],
        processingDurationMs: 100,
        reliabilityScore: 0.3,
        tags: ["duplicate"],
      },
    ],
    releaseRecommendation: "fail",
    generatedAt: "2026-07-01T14:00:00.000Z",
  });
  const events = mapJourneyResultsToReliabilityEvents(report);
  assert.ok(events.length >= 1);
  assert.ok(JOURNEY_RELIABILITY_EVENT_TYPES.includes("journey_duplicate_persisted"));
  const health = journeyReliabilityHealthExtension(report);
  assert.equal(health.journeyCriticalFailures, 1);
});

test("journey: golden suite bridge hook", () => {
  const bridge = bridgeGoldenSuiteToJourney({
    journeyId: "cj-fin-001-gmail-invoice-to-payment",
    goldenCaseId: "gs-001-perfect-tax-invoice",
    goldenPassed: true,
  });
  assert.equal(bridge.bridged, true);
});

test("journey: dry-run never accesses production DB", () => {
  assert.equal(JOURNEY_RELIABILITY_NO_PRODUCTION_DB, true);
  const dataset = buildJourneyDatasetFromRegistry();
  const report = runJourneyReliabilityDryRun(dataset, { mode: "dry_run", dryRun: true });
  assert.equal(report.schemaVersion, JOURNEY_RELIABILITY_VERSION);
  assert.equal(report.totals.journeys, JOURNEY_REGISTRY.length);
});

test("journey: implemented journey runs assertions", () => {
  const journey = findJourneyInRegistry("cj-fin-001-gmail-invoice-to-payment");
  assert.ok(journey);
  const result = runJourneyDryRun(journey!, { mode: "dry_run", dryRun: true, injectFailures: true });
  assert.equal(result.journeyId, "cj-fin-001-gmail-invoice-to-payment");
  assert.ok(result.assertionResults.length > 0);
  assert.ok(result.failureInjectionResults && result.failureInjectionResults.length > 0);
});

test("journey: scaffold journeys pass with warning", () => {
  const journey = findJourneyInRegistry("cj-wa-001-image-to-payment");
  assert.ok(journey);
  const result = runJourneyDryRun(journey!, { mode: "dry_run", dryRun: true });
  assert.equal(result.passed, true);
  assert.ok(result.warnings.some((w) => w.includes("scaffold-only")));
});

test("journey: reliability score computation", () => {
  const score = computeJourneyReliabilityScore({
    assertionPassRate: 1,
    stepPassRate: 1,
    failureInjectionPassRate: 1,
  });
  assert.equal(score, 1);
});

test("journey: example fixture validates", () => {
  const journey = loadExampleJourney();
  assert.equal(journey.journeyId, "cj-fin-001-gmail-invoice-to-payment");
  const issues = validateJourneyDataset({ version: JOURNEY_RELIABILITY_VERSION, journeys: [journey] });
  assert.deepEqual(issues, []);
});

test("journey: list helpers", () => {
  assert.ok(listImplementedJourneys().length >= 1);
  assert.ok(listCriticalJourneys().length >= 4);
});

test("journey: failed journey links", () => {
  const report = buildJourneyReliabilityReport({
    mode: "dry_run",
    results: [
      {
        journeyId: "cj-fail",
        category: "payments",
        criticality: "critical",
        passed: false,
        warnings: [],
        failures: ["fail"],
        stepResults: [],
        assertionResults: [],
        processingDurationMs: 1,
        reliabilityScore: 0,
        tags: [],
      },
    ],
    releaseRecommendation: "fail",
  });
  const links = listFailedJourneyLinks(report);
  assert.equal(links.length, 1);
  assert.match(links[0].detailPath, /cj-fail/);
});
