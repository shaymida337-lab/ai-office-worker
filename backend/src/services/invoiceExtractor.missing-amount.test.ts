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

test("invoiceExtractor detects a small amount but still needs review when supplier is unverifiable", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const invoice = await extractInvoiceData('סה"כ לתשלום: 1 ש"ח', "חשבונית", []);

  // הסכום עצמו זוהה נכון (amountMissing נשאר אות מדויק על הסכום)...
  assert.equal(invoice.amount, 1);
  assert.equal((invoice as { amountMissing?: boolean }).amountMissing, false);
  // ...אבל אכיפת "אפס ניחוש" (תיקון #2): בלי ספק מאומת — needs_review.
  assert.equal(invoice.status, "needs_review");
});

test("invoiceExtractor does not mark explicit zero amount as missing, but routes to review without supplier", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const invoice = await extractInvoiceData('סה"כ לתשלום: 0 ש"ח', "חשבונית", []);

  assert.equal(invoice.amount, 0);
  assert.equal((invoice as { amountMissing?: boolean }).amountMissing, false);
  // אפס מפורש אינו "סכום חסר", אך עדיין חסר ספק מאומת ⇒ needs_review.
  assert.equal(invoice.status, "needs_review");
});
