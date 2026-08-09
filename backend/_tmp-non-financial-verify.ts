import assert from "node:assert/strict";
import { extractDeterministicInvoiceFieldsFromPdfText } from "./src/services/invoice/pdfTextInvoiceExtraction.ts";
import { loadInvoiceGoldenManifest, runInvoiceGoldenDataset, runInvoiceGoldenFixture } from "./src/services/invoice/invoiceGoldenRunner.ts";

const nonFinText = `Team weekly sync agenda
Hello everyone,
Please join the Friday planning call.
No payment, no invoice, no receipt.
Topics: roadmap, hiring, snacks.`;

const nonFinExtracted = extractDeterministicInvoiceFieldsFromPdfText(nonFinText);
assert.equal(nonFinExtracted.supplierName, null);
assert.equal(nonFinExtracted.totalAmount, null);

assert.equal(
  extractDeterministicInvoiceFieldsFromPdfText(`Invoice
Beta Office Supplies Ltd
Invoice date: 2026-06-15
Total amount due $118.00 USD`).supplierName,
  "Beta Office Supplies Ltd"
);
assert.equal(
  extractDeterministicInvoiceFieldsFromPdfText(`Tax Invoice
Acme Services Ltd
Total amount due $50.00 USD`).supplierName,
  "Acme Services Ltd"
);
assert.equal(
  extractDeterministicInvoiceFieldsFromPdfText(`Invoice No. 1042
Zeta Media Group
Total amount due $20.00 USD`).supplierName,
  "Zeta Media Group"
);
assert.equal(
  extractDeterministicInvoiceFieldsFromPdfText(`Please review the invoice attached below.
Topics: roadmap, hiring, snacks.`).supplierName,
  null
);

const manifest = loadInvoiceGoldenManifest();
const nonFin = runInvoiceGoldenFixture(manifest.fixtures.find((f) => f.id === "en_non_financial_001")!);
assert.equal(nonFin.passed, true);
assert.equal(nonFin.actual.supplierName, null);
assert.equal(nonFin.actual.destination, "excluded");

const report = runInvoiceGoldenDataset();
assert.equal(report.totals.passed, 20);
assert.equal(report.totals.failed, 0);
for (const result of report.results) {
  assert.equal(result.passed, true, `${result.fixtureId} must pass`);
}

console.log("EXPLICIT_CHECKS_OK");
