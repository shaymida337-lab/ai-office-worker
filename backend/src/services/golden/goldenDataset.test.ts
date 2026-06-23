import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GOLDEN_FIXTURE_PATH,
  loadGoldenDataset,
  validateGoldenDataset,
} from "./goldenDataset.js";
import {
  compareGoldenExpected,
  formatGoldenFailure,
  runGoldenCase,
  runGoldenDataset,
} from "./goldenRunner.js";
import { GOLDEN_VERSION } from "./goldenTypes.js";

test("golden: loads sample dataset from fixture file", () => {
  const dataset = loadGoldenDataset();

  assert.equal(dataset.version, GOLDEN_VERSION);
  assert.ok(dataset.cases.length >= 10);
});

test("golden: validates sample dataset schema", () => {
  const dataset = loadGoldenDataset();
  const issues = validateGoldenDataset(dataset);

  assert.deepEqual(issues, []);
});

test("golden: rejects invalid dataset schema", () => {
  const issues = validateGoldenDataset({
    version: "golden-v0",
    cases: [],
  });

  assert.ok(issues.some((issue) => issue.path === "version"));
  assert.ok(issues.some((issue) => issue.path === "cases"));
});

test("golden: runs full sample dataset with zero failures", () => {
  const result = runGoldenDataset();

  if (result.failed > 0) {
    const details = result.results
      .filter((item) => !item.passed)
      .map((item) => formatGoldenFailure(item))
      .join("\n");
    assert.fail(`Golden dataset regressions detected:\n${details}`);
  }

  assert.equal(result.total, result.passed);
  assert.ok(result.total >= 10);
});

test("golden: runGoldenCase returns clear failure details", () => {
  const dataset = loadGoldenDataset();
  const baseCase = dataset.cases[0];
  const failingCase = {
    ...baseCase,
    expected: {
      ...baseCase.expected,
      amount: (baseCase.expected.amount ?? 0) + 1,
    },
  };

  const result = runGoldenCase(failingCase);

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.startsWith("amount expected")));
  assert.match(formatGoldenFailure(result), /amount expected/);
});

test("golden: compareGoldenExpected detects outcome mismatch", () => {
  const dataset = loadGoldenDataset();
  const result = runGoldenCase(dataset.cases[0]);
  const failures = compareGoldenExpected(
    {
      ...result.expected,
      outcomeStatus: "ERROR",
      shouldAutoSave: false,
      shouldNeedReview: false,
      shouldReject: true,
      reason: "forced mismatch",
    },
    result.actual
  );

  assert.ok(failures.some((failure) => failure.startsWith("outcomeStatus expected")));
});

test("golden: default fixture path points at sample file", () => {
  assert.match(DEFAULT_GOLDEN_FIXTURE_PATH, /golden-documents\.sample\.json$/);
  assert.doesNotThrow(() => loadGoldenDataset(DEFAULT_GOLDEN_FIXTURE_PATH));
});
