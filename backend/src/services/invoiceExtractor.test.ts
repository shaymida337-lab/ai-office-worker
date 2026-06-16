import test from "node:test";
import assert from "node:assert/strict";
import { parseAmount } from "./invoiceExtractor.js";

test("parseAmount treats one or two dot digits as decimals and three as thousands", () => {
  assert.equal(parseAmount("43.9"), 43.9);
  assert.equal(parseAmount("43.90"), 43.9);
  assert.equal(parseAmount("11.800"), 11800);
  assert.equal(parseAmount("163.28"), 163.28);
  assert.equal(parseAmount("119"), 119);
});
