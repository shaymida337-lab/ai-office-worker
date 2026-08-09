import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isConfidentlyNotFinancialDocument,
  resolveExtractedDocumentFinancial,
} from "./src/services/classification/financialDocumentClassification.ts";
import { extractDeterministicInvoiceFieldsFromPdfText } from "./src/services/invoice/pdfTextInvoiceExtraction.ts";
import { loadInvoiceGoldenManifest, runInvoiceGoldenFixture } from "./src/services/invoice/invoiceGoldenRunner.ts";

// unknown type + strong financial signals → not excluded
const strong = {
  documentType: null as string | null,
  supplierName: "פי שירותים בע״מ",
  totalAmount: 400,
  pdfText: `מסמך כללי
שם ספק: פי שירותים בע״מ
תאריך חשבונית: 16/06/2026
₪400.00 סה״כ לתשלום`,
};
assert.equal(resolveExtractedDocumentFinancial(strong), true);
assert.equal(isConfidentlyNotFinancialDocument(strong), false);

// unknown type without financial signals → excluded
assert.equal(
  isConfidentlyNotFinancialDocument({
    documentType: null,
    supplierName: null,
    totalAmount: null,
    pdfText: "מסמך כללי בלי סכום",
  }),
  true
);

// explicit raw types stay excluded
assert.equal(
  isConfidentlyNotFinancialDocument({
    documentType: "supplier_message",
    supplierName: "פי שירותים בע״מ",
    totalAmount: 400,
    pdfText: "₪400.00 סה״כ לתשלום",
  }),
  true
);
assert.equal(
  isConfidentlyNotFinancialDocument({
    documentType: "logo_image",
    supplierName: "Brand",
    totalAmount: 10,
    pdfText: "logo",
    filename: "logo.png",
    mimeType: "image/png",
  }),
  true
);

// no documentType guessing on the unknown-doctype fixture text
const text = readFileSync(
  join("test-fixtures/invoices/golden/files/he_unknown_doctype_001.txt"),
  "utf8"
);
const extracted = extractDeterministicInvoiceFieldsFromPdfText(text);
assert.equal(extracted.documentType, null);

const manifest = loadInvoiceGoldenManifest();
const unknown = runInvoiceGoldenFixture(
  manifest.fixtures.find((f) => f.id === "he_unknown_doctype_001")!
);
assert.equal(unknown.passed, true);
assert.equal(unknown.actual.destination, "completion");
assert.ok(unknown.actual.missingDataReasons.includes("סוג מסמך חסר"));

const nonFin = runInvoiceGoldenFixture(
  manifest.fixtures.find((f) => f.id === "en_non_financial_001")!
);
assert.equal(nonFin.passed, false);
assert.equal(nonFin.actual.destination, "excluded");

console.log("EXPLICIT_CHECKS_OK");
