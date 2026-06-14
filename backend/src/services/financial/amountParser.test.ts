import test from "node:test";
import assert from "node:assert/strict";
import { parseMoneyAmount } from "./amountParser.js";

test("parses comma thousands as Israeli thousands", () => {
  const result = parseMoneyAmount("11,800");

  assert.equal(result.amount, 11800);
  assert.equal(result.normalizedText, "11800");
  assert.equal(result.rejectedReason, null);
});

test("parses dot thousands as Israeli thousands", () => {
  const result = parseMoneyAmount("11.800");

  assert.equal(result.amount, 11800);
  assert.equal(result.normalizedText, "11800");
});

test("parses US mixed separators", () => {
  const result = parseMoneyAmount("1,234.56");

  assert.equal(result.amount, 1234.56);
  assert.equal(result.normalizedText, "1234.56");
});

test("parses Israeli mixed separators", () => {
  const result = parseMoneyAmount("1.234,56");

  assert.equal(result.amount, 1234.56);
  assert.equal(result.normalizedText, "1234.56");
});

test("flags two-digit comma decimal as suspicious", () => {
  const result = parseMoneyAmount("11,80");

  assert.equal(result.amount, 11.8);
  assert.equal(result.confidence, "low");
  assert.ok(result.warnings.some((warning) => warning.includes("suspicious_decimal_comma")));
});

test("corrects numeric AI amount when OCR raw text has thousands amount", () => {
  const result = parseMoneyAmount(11.8, {
    source: "ai_json",
    ocrRawText: "סה״כ לתשלום 11,800",
  });

  assert.equal(result.amount, 11800);
  assert.notEqual(result.amount, 11.8);
  assert.ok(result.warnings.some((warning) => warning.includes("ai_numeric_amount_conflicts_with_ocr_raw_text")));
});

test("parses Hebrew total label amount", () => {
  const result = parseMoneyAmount("סה״כ לתשלום 11,800");

  assert.equal(result.amount, 11800);
  assert.equal(result.rejectedReason, null);
});

test("selects total over subtotal and VAT amounts", () => {
  const result = parseMoneyAmount("subtotal 10,000 VAT 1,800 סה״כ לתשלום 11,800");

  assert.equal(result.amount, 11800);
});

test("does not treat reference-number-adjacent value as amount", () => {
  const result = parseMoneyAmount("מספר חשבונית 11800");

  assert.equal(result.amount, null);
  assert.equal(result.rejectedReason, "no_amount_found");
});

test("rejects negative amount", () => {
  const result = parseMoneyAmount("-10");

  assert.equal(result.amount, null);
  assert.equal(result.rejectedReason, "amount_must_be_positive");
});

test("rejects zero amount", () => {
  const result = parseMoneyAmount("0");

  assert.equal(result.amount, null);
  assert.equal(result.rejectedReason, "amount_must_be_positive");
});

test("flags very large amount for review signal", () => {
  const result = parseMoneyAmount("₪1,500,000");

  assert.equal(result.amount, 1500000);
  assert.equal(result.confidence, "low");
  assert.ok(result.warnings.some((warning) => warning.includes("amount_above_max_reasonable")));
});
