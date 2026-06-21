import test from "node:test";
import assert from "node:assert/strict";
import { extractInvoiceAmount, rejectedDetectedAmountReason } from "./gmail-sync.js";
import { financialDocumentBlockingReason } from "./financialDocuments.js";

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

test("rejectedDetectedAmountReason rejects year-like amounts only with date context", () => {
  assert.equal(rejectedDetectedAmountReason(2000), null);
  assert.equal(rejectedDetectedAmountReason(1950), null);
  assert.equal(rejectedDetectedAmountReason(2025), null);
  assert.equal(rejectedDetectedAmountReason(2025, { hasDateContext: true }), "parsed amount looks like a year");
  assert.equal(rejectedDetectedAmountReason(2026, { hasDateContext: true }), "parsed amount looks like a year");
  assert.equal(rejectedDetectedAmountReason(2024, { hasDateContext: true }), "parsed amount looks like a year");
  assert.equal(rejectedDetectedAmountReason(0), "parsed amount looks invalid");
  assert.equal(rejectedDetectedAmountReason(-10), "parsed amount looks invalid");
  assert.equal(rejectedDetectedAmountReason(1_000_000), "parsed amount looks invalid/too large");
  assert.equal(rejectedDetectedAmountReason(999_999), null);
  assert.equal(rejectedDetectedAmountReason(10_000_001), "parsed amount looks invalid/too large");
  assert.equal(rejectedDetectedAmountReason(43.9), null);
  assert.equal(rejectedDetectedAmountReason(163.28), null);
  assert.equal(rejectedDetectedAmountReason(1850), null);
  assert.equal(rejectedDetectedAmountReason(2101), null);
});

test("extractInvoiceAmount prefers total keyword amount over account identifier number", () => {
  const result = extractInvoiceAmount(`
    סה"כ לתשלום: 4,236 ₪
    מספר חשבון 1000000
  `);

  assert.equal(result.amount, 4236);
});

test("extractInvoiceAmount ignores long identifier-only numbers", () => {
  assert.equal(extractInvoiceAmount("טלפון 0501234567").amount, null);
  assert.equal(extractInvoiceAmount("reference 123456789012").amount, null);
  assert.equal(extractInvoiceAmount("מספר חשבון 1000000").amount, null);
});

test("financialDocumentBlockingReason flags amount at 1M threshold for needs_review", () => {
  const reason = financialDocumentBlockingReason({
    supplierName: "OpenAI LLC",
    invoiceNumber: "INV-2026-1001",
    totalAmount: 1_000_000,
    documentDate: "2026-06-01",
  });

  assert.match(reason ?? "", /exceeds review threshold/);
});
