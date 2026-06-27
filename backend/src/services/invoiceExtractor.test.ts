import test from "node:test";
import assert from "node:assert/strict";
import { parseAmountOrNull as parseAmount } from "./amount/parseAmount.js";

test("parseAmount via canonical module", () => {
  assert.equal(parseAmount("43.9"), 43.9);
  assert.equal(parseAmount("43.90"), 43.9);
  assert.equal(parseAmount("163.28"), 163.28);
  assert.equal(parseAmount("119"), 119);
  assert.equal(parseAmount("11.800"), null);
  assert.equal(parseAmount("1,107.23"), 1107.23);
});
