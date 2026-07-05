import test from "node:test";
import assert from "node:assert/strict";
import { formatAmount, MISSING_AMOUNT_LABEL } from "./amount";

test("formatAmount: null/undefined/NaN never crash — render missing label", () => {
  assert.equal(formatAmount(null), MISSING_AMOUNT_LABEL);
  assert.equal(formatAmount(undefined), MISSING_AMOUNT_LABEL);
  assert.equal(formatAmount(Number.NaN), MISSING_AMOUNT_LABEL);
  assert.equal(formatAmount(null, "ILS", "סכום חסר"), "סכום חסר");
});

test("formatAmount: valid amounts keep the existing display format", () => {
  assert.equal(formatAmount(1234.5), "₪ 1,234.5");
  assert.equal(formatAmount(0), "₪ 0");
  assert.equal(formatAmount(100, "USD"), "$ 100");
  assert.equal(formatAmount(100, "EUR"), "€ 100");
  // מטבע לא מוכר — הקוד עצמו מוצג
  assert.equal(formatAmount(100, "CHF"), "CHF 100");
});
