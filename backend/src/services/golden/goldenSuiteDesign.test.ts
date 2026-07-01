import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareGoldenSuiteCase } from "./goldenSuiteComparison.js";
import {
  classifyGoldenCaseResult,
  deriveGoldenReleaseRecommendation,
  diffGoldenBaselines,
} from "./goldenSuiteRegression.js";
import {
  buildGoldenSuiteRegressionReport,
  formatGoldenSuiteRegressionReport,
  listFailedCaseLinks,
} from "./goldenSuiteReport.js";
import {
  GOLDEN_RELIABILITY_EVENT_TYPES,
  goldenSuiteHealthExtension,
  mapGoldenResultsToReliabilityEvents,
} from "./goldenSuiteReliability.js";
import {
  GOLDEN_SUITE_NO_PRODUCTION_DB,
  runGoldenSuiteCaseDryRun,
  runGoldenSuiteDryRun,
} from "./goldenSuiteRunner.js";
import type { GoldenSuiteCase, GoldenSuiteCaseResult, GoldenSuiteDataset } from "./goldenSuiteTypes.js";
import { GOLDEN_SUITE_VERSION } from "./goldenSuiteTypes.js";
import {
  assertValidGoldenSuiteDataset,
  validateGoldenAllowedVariance,
  validateGoldenSuiteCase,
  validateGoldenSuiteDataset,
} from "./goldenSuiteValidation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, "fixtures", "golden-suite");

function loadExampleDataset(): GoldenSuiteDataset {
  const raw = readFileSync(join(FIXTURE_ROOT, "example-dataset.json"), "utf8");
  return JSON.parse(raw) as GoldenSuiteDataset;
}

function baseCase(overrides: Partial<GoldenSuiteCase> = {}): GoldenSuiteCase {
  return {
    caseId: "gs-test-base",
    version: GOLDEN_SUITE_VERSION,
    sourceChannel: "gmail",
    documentFileRef: null,
    expectedDocumentType: "tax_invoice",
    expectedPaymentDirection: "incoming_expense",
    expectedDecisionOutcome: "SAVED",
    expectedPersistenceAction: "auto_save_payment",
    allowedVariance: {},
    criticality: "critical",
    tags: [],
    ...overrides,
  };
}

test("golden-suite: validates example dataset schema", () => {
  const dataset = loadExampleDataset();
  const issues = validateGoldenSuiteDataset(dataset);
  assert.deepEqual(issues, []);
  assert.doesNotThrow(() => assertValidGoldenSuiteDataset(dataset));
});

test("golden-suite: rejects invalid case schema", () => {
  const issues = validateGoldenSuiteCase({
    caseId: "",
    sourceChannel: "invalid",
    expectedDocumentType: "tax_invoice",
    expectedPaymentDirection: "incoming_expense",
    expectedPersistenceAction: "auto_save_payment",
    allowedVariance: {},
    criticality: "critical",
    tags: "not-array",
  });
  assert.ok(issues.some((i) => i.path.includes("caseId")));
  assert.ok(issues.some((i) => i.path.includes("sourceChannel")));
  assert.ok(issues.some((i) => i.path.includes("tags")));
});

test("golden-suite: zero amount requires explicit variance for financial docs", () => {
  const issues = validateGoldenSuiteCase(
    baseCase({
      expectedAmount: 0,
      allowedVariance: {},
    }),
  );
  assert.ok(issues.some((i) => i.path.endsWith("expectedAmount")));
});

test("golden-suite: amount exact match rule passes on equal values", () => {
  const result = compareGoldenSuiteCase(
    baseCase({ expectedAmount: 1180 }),
    {
      supplierName: "Acme",
      amount: 1180,
      documentType: "tax_invoice",
      outcomeStatus: "SAVED",
      reviewStatus: "auto_saved",
      persistenceAction: "auto_save_payment",
      paymentDirection: "incoming_expense",
    },
  );
  assert.equal(result.failures.length, 0);
});

test("golden-suite: amount exact match rule fails on mismatch", () => {
  const result = compareGoldenSuiteCase(
    baseCase({ expectedAmount: 1180 }),
    {
      supplierName: "Acme",
      amount: 1200,
      documentType: "tax_invoice",
      outcomeStatus: "SAVED",
      persistenceAction: "auto_save_payment",
      paymentDirection: "incoming_expense",
    },
  );
  assert.ok(result.failures.some((f) => f.includes("amount")));
  assert.ok(result.changedFields.some((c) => c.field === "amount" && c.classification === "failure"));
});

test("golden-suite: missing amount fails for supplier payments unless allowed", () => {
  const result = compareGoldenSuiteCase(
    baseCase({ expectedAmount: 500 }),
    {
      supplierName: "Vendor",
      amount: null,
      documentType: "tax_invoice",
      outcomeStatus: "NEEDS_REVIEW",
      persistenceAction: "needs_review_fdr",
      paymentDirection: "incoming_expense",
    },
  );
  assert.ok(result.failures.some((f) => f.includes("missing amount")));
});

test("golden-suite: allowed variance downgrades amount mismatch to warning", () => {
  const result = compareGoldenSuiteCase(
    baseCase({ expectedAmount: 1180, allowedVariance: { amount: true } }),
    {
      supplierName: "Acme",
      amount: 1181,
      documentType: "tax_invoice",
      outcomeStatus: "SAVED",
      persistenceAction: "auto_save_payment",
      paymentDirection: "incoming_expense",
    },
  );
  assert.equal(result.failures.length, 0);
  assert.ok(result.warnings.some((w) => w.includes("amount variance")));
});

test("golden-suite: supplier name normalization variance is warning not failure", () => {
  const result = compareGoldenSuiteCase(
    baseCase({
      expectedSupplierName: "Acme Ltd",
      allowedVariance: { supplierName: true },
    }),
    {
      supplierName: "ACME",
      amount: null,
      documentType: "tax_invoice",
      outcomeStatus: "SAVED",
      persistenceAction: "auto_save_payment",
      paymentDirection: "incoming_expense",
    },
  );
  assert.equal(result.failures.filter((f) => f.includes("supplierName")).length, 0);
  assert.ok(result.warnings.some((w) => w.includes("supplier normalization")));
});

test("golden-suite: regression classification and release gates", () => {
  const passResult: GoldenSuiteCaseResult = {
    caseId: "pass",
    criticality: "standard",
    passed: true,
    warnings: [],
    failures: [],
    changedFields: [],
    tags: [],
  };
  assert.equal(classifyGoldenCaseResult(passResult), "pass");
  assert.equal(deriveGoldenReleaseRecommendation({ results: [passResult] }), "pass");

  const criticalFail: GoldenSuiteCaseResult = {
    caseId: "critical",
    criticality: "critical",
    passed: false,
    warnings: [],
    failures: ["documentType mismatch"],
    changedFields: [],
    tags: [],
  };
  assert.equal(classifyGoldenCaseResult(criticalFail), "critical_failure");
  assert.equal(deriveGoldenReleaseRecommendation({ results: [criticalFail] }), "fail");

  const amountFail: GoldenSuiteCaseResult = {
    caseId: "amount",
    criticality: "standard",
    passed: false,
    warnings: [],
    failures: ["amount"],
    changedFields: [
      {
        field: "amount",
        expected: 100,
        actual: 200,
        classification: "failure",
        reason: "exact amount match required",
      },
    ],
    tags: [],
  };
  assert.equal(deriveGoldenReleaseRecommendation({ results: [amountFail] }), "fail");

  const warnOnly: GoldenSuiteCaseResult = {
    caseId: "warn",
    criticality: "standard",
    passed: true,
    warnings: ["supplier normalization"],
    failures: [],
    changedFields: [],
    tags: [],
  };
  assert.equal(deriveGoldenReleaseRecommendation({ results: [warnOnly] }), "warn");
});

test("golden-suite: baseline diff detects new failures", () => {
  const previous: GoldenSuiteCaseResult[] = [
    {
      caseId: "a",
      criticality: "standard",
      passed: true,
      warnings: [],
      failures: [],
      changedFields: [],
      tags: [],
    },
  ];
  const current: GoldenSuiteCaseResult[] = [
    {
      caseId: "a",
      criticality: "standard",
      passed: false,
      warnings: [],
      failures: ["regression"],
      changedFields: [{ field: "amount", expected: 1, actual: 2, classification: "failure", reason: "x" }],
      tags: [],
    },
  ];
  const diff = diffGoldenBaselines({ baselineId: "ci-baseline", previous, current });
  assert.deepEqual(diff.newFailures, ["a"]);
  assert.equal(deriveGoldenReleaseRecommendation({ results: current, baselineDiff: diff }), "fail");
});

test("golden-suite: report generation includes totals and failed case links", () => {
  const report = buildGoldenSuiteRegressionReport({
    mode: "dry_run",
    results: [
      {
        caseId: "gs-fail",
        criticality: "critical",
        passed: false,
        warnings: [],
        failures: ["blocked persistence"],
        changedFields: [],
        tags: ["duplicate"],
      },
    ],
    releaseRecommendation: "fail",
    generatedAt: "2026-07-01T12:00:00.000Z",
  });

  assert.equal(report.totals.failed, 1);
  assert.equal(report.releaseRecommendation, "fail");
  const text = formatGoldenSuiteRegressionReport(report);
  assert.match(text, /Release recommendation: FAIL/);
  const links = listFailedCaseLinks(report);
  assert.equal(links.length, 1);
  assert.match(links[0].detailPath, /gs-fail/);
});

test("golden-suite: reliability event mapping for regressions", () => {
  const report = buildGoldenSuiteRegressionReport({
    mode: "dry_run",
    results: [
      {
        caseId: "gs-amount",
        criticality: "critical",
        passed: false,
        warnings: [],
        failures: ["amount"],
        changedFields: [
          { field: "amount", expected: 1, actual: 2, classification: "failure", reason: "exact" },
        ],
        tags: [],
      },
      {
        caseId: "gs-dup",
        criticality: "critical",
        passed: false,
        warnings: [],
        failures: ["duplicate persistence"],
        changedFields: [],
        tags: ["duplicate"],
      },
    ],
    releaseRecommendation: "fail",
    generatedAt: "2026-07-01T12:00:00.000Z",
  });

  const events = mapGoldenResultsToReliabilityEvents(report);
  assert.ok(events.length >= 2);
  assert.ok(GOLDEN_RELIABILITY_EVENT_TYPES.includes("amount_regression_detected"));
  assert.ok(GOLDEN_RELIABILITY_EVENT_TYPES.includes("duplicate_regression_detected"));

  const health = goldenSuiteHealthExtension(report);
  assert.equal(health.goldenCriticalFailures, 2);
  assert.equal(health.releaseRecommendation, "fail");
});

test("golden-suite: dry-run runner never accesses production DB", () => {
  assert.equal(GOLDEN_SUITE_NO_PRODUCTION_DB, true);
  const dataset = loadExampleDataset();
  const report = runGoldenSuiteDryRun(dataset, { mode: "dry_run", dryRun: true });
  assert.equal(report.schemaVersion, GOLDEN_SUITE_VERSION);
  assert.equal(report.totals.cases, dataset.cases.length);
});

test("golden-suite: bridged pipeline case executes golden-v1 engine", () => {
  const dataset = loadExampleDataset();
  const bridged = dataset.cases.find((c) => c.pipelineCaseId === "gd-001-perfect-tax-invoice");
  assert.ok(bridged);
  const result = runGoldenSuiteCaseDryRun(bridged!);
  assert.equal(result.caseId, "gs-001-perfect-tax-invoice");
  assert.ok(Array.isArray(result.failures));
  assert.ok(Array.isArray(result.warnings));
});

test("golden-suite: scaffold-only case passes with warning", () => {
  const dataset = loadExampleDataset();
  const scaffold = dataset.cases.find((c) => c.caseId === "gs-scaffold-non-financial");
  assert.ok(scaffold);
  const result = runGoldenSuiteCaseDryRun(scaffold!);
  assert.equal(result.passed, true);
  assert.ok(result.warnings.some((w) => w.includes("scaffold-only")));
});

test("golden-suite: allowedVariance validation rejects bad confidence delta", () => {
  const issues = validateGoldenAllowedVariance({ confidenceScoreDelta: 2 }, "allowedVariance");
  assert.ok(issues.some((i) => i.path.includes("confidenceScoreDelta")));
});
