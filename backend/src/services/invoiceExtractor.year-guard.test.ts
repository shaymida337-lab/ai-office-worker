import test from "node:test";
import assert from "node:assert/strict";

test("invoiceExtractor keeps 2000 as a legitimate round amount", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const amount2000 = await extractInvoiceData('סה"כ לתשלום: 2000 ש"ח', "חשבונית", []);

  assert.equal(amount2000.amount, 2000);
});

test("invoiceExtractor keeps 1950 as a legitimate round amount", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const amount1950 = await extractInvoiceData('סה"כ לתשלום: 1950 ש"ח', "חשבונית", []);

  assert.equal(amount1950.amount, 1950);
});

test("invoiceExtractor keeps bare 2025 as a legitimate amount", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const amount2025 = await extractInvoiceData('סה"כ לתשלום: 2025 ש"ח', "חשבונית", []);

  assert.equal(amount2025.amount, 2025);
});

test("invoiceExtractor still filters years that appear in date context", async () => {
  process.env.ANTHROPIC_API_KEY = "";
  const { extractInvoiceData } = await import("./invoiceExtractor.js");
  const dateYear = await extractInvoiceData("לתשלום עד 2025-05-14", "חשבונית", []);

  assert.equal(dateYear.amount, 0);
});
