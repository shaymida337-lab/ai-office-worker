import test from "node:test";
import assert from "node:assert/strict";
import {
  assertFinancialIngestionAllowed,
  FinancialIngestionBlockedError,
  isFinancialDataContainmentActive,
  isFinancialDataPath,
} from "./financialContainment.js";

test("isFinancialDataPath covers financial reads and ingestion routes", () => {
  assert.equal(isFinancialDataPath("/invoices"), true);
  assert.equal(isFinancialDataPath("/payments"), true);
  assert.equal(isFinancialDataPath("/document-reviews"), true);
  assert.equal(isFinancialDataPath("/gmail/scan"), true);
  assert.equal(isFinancialDataPath("/gmail/scan/abc123"), true);
  assert.equal(isFinancialDataPath("/verification"), true);
  assert.equal(isFinancialDataPath("/dashboard/stats"), false);
});

test("assertFinancialIngestionAllowed blocks when containment active", () => {
  const previous = process.env.FINANCIAL_DATA_CONTAINMENT;
  process.env.FINANCIAL_DATA_CONTAINMENT = "1";
  try {
    assert.equal(isFinancialDataContainmentActive(), true);
    assert.throws(() => assertFinancialIngestionAllowed("org-a"), FinancialIngestionBlockedError);
  } finally {
    if (previous === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previous;
  }
});

test("assertFinancialIngestionAllowed allows when containment disabled", () => {
  const previous = process.env.FINANCIAL_DATA_CONTAINMENT;
  process.env.FINANCIAL_DATA_CONTAINMENT = "0";
  try {
    assert.doesNotThrow(() => assertFinancialIngestionAllowed("org-a"));
  } finally {
    if (previous === undefined) delete process.env.FINANCIAL_DATA_CONTAINMENT;
    else process.env.FINANCIAL_DATA_CONTAINMENT = previous;
  }
});
