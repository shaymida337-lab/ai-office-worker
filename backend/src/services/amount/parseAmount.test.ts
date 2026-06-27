import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseAmountOrNull } from "./parseAmount.js";

test("parseAmount: standard Israeli/US grouped decimals", () => {
  assert.equal(parseAmount("1,107.23").parsedAmount, 1107.23);
  assert.equal(parseAmount("1,107.23").ambiguous, false);
  assert.equal(parseAmount("1,107.00").parsedAmount, 1107);
  assert.equal(parseAmount("1107.23").parsedAmount, 1107.23);
  assert.equal(parseAmount("1.107,23").parsedAmount, 1107.23);
  assert.equal(parseAmount("₪1,107.23").parsedAmount, 1107.23);
  assert.equal(parseAmount('סה"כ לתשלום 1,107.23').parsedAmount, 1107.23);
});

test("parseAmount: ambiguous separator forms without label", () => {
  for (const raw of ["110,723", "110.723", "11.800"]) {
    const result = parseAmount(raw);
    assert.equal(result.parsedAmount, null, raw);
    assert.equal(result.ambiguous, true, raw);
  }
});

test("parseAmount: labeled ambiguous forms still parse but stay flagged", () => {
  const result = parseAmount("110.723", { stronglyLabeled: true });
  assert.equal(result.parsedAmount, 110723);
  assert.equal(result.ambiguous, true);
});

test("parseAmountOrNull returns null for ambiguous", () => {
  assert.equal(parseAmountOrNull("110,723"), null);
  assert.equal(parseAmountOrNull("1,107.23"), 1107.23);
});

test("parseAmount: MAX-style receipt total", () => {
  assert.equal(parseAmount("1,107.23").parsedAmount, 1107.23);
  assert.equal(parseAmountOrNull("110723"), 110723);
  assert.equal(parseAmountOrNull("110.723"), null);
});
