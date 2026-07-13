import assert from "node:assert/strict";
import { test } from "node:test";
import { extractInvoiceAmount } from "./gmail-sync.js";

test("English billing table: Total Amount wins over Subtotal/Tax (Microsoft regression)", () => {
  const result = extractInvoiceAmount(
    "Billing Summary\nSubtotal $95.00\nTax $19.00\nTotal Amount $114.00"
  );
  assert.equal(result.amount, 114);
});

test("Grand Total is prioritized", () => {
  assert.equal(extractInvoiceAmount("Subtotal $100.00\nShipping $10.00\nGrand Total $114.00").amount, 114);
  assert.equal(extractInvoiceAmount("Grand Total $114").amount, 114);
});

test("Amount Due / Total Due / Balance Due are prioritized", () => {
  assert.equal(extractInvoiceAmount("Amount Due $114.00").amount, 114);
  assert.equal(extractInvoiceAmount("Subtotal $95.00\nVAT $19.00\nTotal Due USD 114.00").amount, 114);
  assert.equal(extractInvoiceAmount("Discount $5.00\nBalance Due $114.00").amount, 114);
});

test("Subtotal and Tax only, no total label — do not guess", () => {
  const result = extractInvoiceAmount("Billing Summary\nSubtotal $95.00\nTax $19.00");
  assert.equal(result.amount, null);
});

test("'Subtotal' does not leak into the total tier via the word 'total'", () => {
  // בלי \b, "Subtotal Amount $95.00" היה נתפס כ-"total amount"
  const result = extractInvoiceAmount("Subtotal Amount $95.00\nTax $19.00");
  assert.equal(result.amount, null);
});

test("Hebrew extraction is unchanged: סה\"כ לתשלום wins in a Hebrew billing table", () => {
  const result = extractInvoiceAmount(
    'סיכום חיוב\nביניים 95.00 ₪\nמע"מ 19.00 ₪\nסה"כ לתשלום 114.00 ₪'
  );
  assert.equal(result.amount, 114);
});

test("Hebrew single-amount documents are unchanged", () => {
  assert.equal(extractInvoiceAmount("סכום לתשלום: 250 ₪").amount, 250);
  assert.equal(extractInvoiceAmount("יתרה לתשלום 1,107.23 ₪").amount, 1107.23);
});
