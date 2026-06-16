import test from "node:test";
import assert from "node:assert/strict";
import { extractInvoiceAmount, rejectedDetectedAmountReason } from "./gmail-sync.js";

test("extractInvoiceAmount rejects a date year when no real total is present", () => {
  const result = extractInvoiceAmount(`
    חשבונית פנגו
    לתשלום עד 2025-05-14
    ספק: pango
  `);

  assert.equal(result.amount, null);
});

test("extractInvoiceAmount keeps a real decimal total alongside a date year", () => {
  const result = extractInvoiceAmount(`
    חשבונית פנגו
    לתשלום עד 2025-05-14
    סה"כ לתשלום: 45.60
  `);

  assert.equal(result.amount, 45.6);
});

test("rejectedDetectedAmountReason rejects only integer year-like amounts", () => {
  assert.notEqual(rejectedDetectedAmountReason(2025), null);
  assert.notEqual(rejectedDetectedAmountReason(2018), null);
  assert.equal(rejectedDetectedAmountReason(43.9), null);
  assert.equal(rejectedDetectedAmountReason(163.28), null);
  assert.equal(rejectedDetectedAmountReason(1850), null);
  assert.equal(rejectedDetectedAmountReason(2101), null);
});
