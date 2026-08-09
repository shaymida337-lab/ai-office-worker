import assert from "node:assert/strict";
import { isLikelyJunkSupplierName } from "./src/services/supplierNameValidation.ts";
import { extractDeterministicInvoiceFieldsFromPdfText } from "./src/services/invoice/pdfTextInvoiceExtraction.ts";

const mustStayValid = [
  "אלפא שירותים בע״מ",
  'א.א. שירותי ניקיון בע"מ',
  "קסי שירותי ענן בע״מ",
  "בזק",
  "Wolt",
  "Beta Office Supplies Ltd",
  "חברת החשמל",
];
for (const name of mustStayValid) {
  assert.equal(isLikelyJunkSupplierName(name), false, `junk falsely flagged: ${name}`);
}

// Words תאריך/מספר inside a real name (not as a leading label) must not junk.
assert.equal(isLikelyJunkSupplierName("סטודיו תאריך בע״מ"), false);
assert.equal(isLikelyJunkSupplierName("קפה המספר בע״מ"), false);

// Leading metadata labels still junk.
assert.equal(isLikelyJunkSupplierName("תאריך חשבונית: 14/06/2026"), true);
assert.equal(isLikelyJunkSupplierName("מספר מסמך: X"), true);

// Supplier after invoice title still extracts (he + en), including שירותים.
const afterTitle = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס
אלפא שירותים בע״מ
תאריך חשבונית: 15/06/2026
₪100.00 סה״כ לתשלום`);
assert.equal(afterTitle.supplierName, "אלפא שירותים בע״מ");

const enAfterTitle = extractDeterministicInvoiceFieldsFromPdfText(`Invoice
Beta Office Supplies Ltd
Invoice date: 2026-06-15
Total amount due $118.00 USD`);
assert.equal(enAfterTitle.supplierName, "Beta Office Supplies Ltd");

console.log("REGRESSION_CHECKS_OK");
