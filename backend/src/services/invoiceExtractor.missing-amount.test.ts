import test from "node:test";
import assert from "node:assert/strict";

test("invoiceExtractor marks genuinely missing amount instead of silent zero", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const invoice = await extractInvoiceData("חשבונית ללא סכום ברור", "חשבונית", []);

  assert.equal(invoice.amount, 0);
  assert.equal((invoice as { amountMissing?: boolean }).amountMissing, true);
  assert.equal(invoice.status, "needs_review");
});

test("invoiceExtractor keeps found small amount on normal status", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const invoice = await extractInvoiceData('סה"כ לתשלום: 1 ש"ח', "חשבונית", []);

  assert.equal(invoice.amount, 1);
  assert.equal((invoice as { amountMissing?: boolean }).amountMissing, false);
  assert.equal(invoice.status, "pending");
});

test("invoiceExtractor does not mark explicit zero amount as missing", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const invoice = await extractInvoiceData('סה"כ לתשלום: 0 ש"ח', "חשבונית", []);

  assert.equal(invoice.amount, 0);
  assert.equal((invoice as { amountMissing?: boolean }).amountMissing, false);
  assert.equal(invoice.status, "pending");
});
