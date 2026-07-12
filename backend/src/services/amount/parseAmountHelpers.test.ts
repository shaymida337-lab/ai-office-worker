import assert from "node:assert/strict";
import { test } from "node:test";
import { roundMoney, roundMoneyOrNull } from "./parseAmountHelpers.js";

test("roundMoneyOrNull rounds raw model amounts to 2 decimals (VAT fallback regression)", () => {
  // הרגרסיה: analysis.amountBeforeVat נשמר גולמי עם 3 ספרות עשרוניות
  assert.equal(roundMoneyOrNull(920219.813), 920219.81);
  assert.equal(roundMoneyOrNull(786.512), 786.51);
  assert.equal(roundMoneyOrNull(133.302), 133.3);
  assert.equal(roundMoneyOrNull(43.9), 43.9);
  assert.equal(roundMoneyOrNull(119), 119);
});

test("roundMoneyOrNull is null-safe: null/undefined/NaN/Infinity → null", () => {
  assert.equal(roundMoneyOrNull(null), null);
  assert.equal(roundMoneyOrNull(undefined), null);
  assert.equal(roundMoneyOrNull(Number.NaN), null);
  assert.equal(roundMoneyOrNull(Number.POSITIVE_INFINITY), null);
});

test("roundMoney stays the canonical 2-decimal rounding", () => {
  assert.equal(roundMoney(920219.813), 920219.81);
  assert.equal(roundMoney(0.005), 0.01);
});
