import assert from "node:assert/strict";
import { test } from "node:test";
import { isLikelyJunkSupplierName } from "./supplierNameValidation.js";

test("isLikelyJunkSupplierName flags real-world garbage supplier values", () => {
  const junk = [
    'parsed)firstString =',
    "FieldsFromText",
    "detection",
    "review amounts to zero",
    "rawOcrText=supplier",
    "null",
    "undefined",
  ] as const;

  for (const name of junk) {
    assert.equal(isLikelyJunkSupplierName(name), true, `expected junk: ${name}`);
  }
});

test("isLikelyJunkSupplierName allows legitimate supplier names", () => {
  const valid = [
    "חברת החשמל",
    "Wolt",
    "Anthropic PBC",
    "וולט אנטרפרייזס ישראל",
    "Fraud Detection Ltd",
    "Super Pharm",
    "בזק",
  ] as const;

  for (const name of valid) {
    assert.equal(isLikelyJunkSupplierName(name), false, `expected valid: ${name}`);
  }
});
