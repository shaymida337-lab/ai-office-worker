import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHistoricalScanYears } from "./businessTemplates.js";

test("normalizeHistoricalScanYears accepts 1–5", () => {
  assert.equal(normalizeHistoricalScanYears(1), 1);
  assert.equal(normalizeHistoricalScanYears(5), 5);
  assert.equal(normalizeHistoricalScanYears("3"), 3);
  assert.equal(normalizeHistoricalScanYears(3.9), 3);
});

test("normalizeHistoricalScanYears rejects out of range", () => {
  assert.equal(normalizeHistoricalScanYears(0), null);
  assert.equal(normalizeHistoricalScanYears(6), null);
  assert.equal(normalizeHistoricalScanYears(-1), null);
  assert.equal(normalizeHistoricalScanYears("nope"), null);
  assert.equal(normalizeHistoricalScanYears(undefined), null);
});
