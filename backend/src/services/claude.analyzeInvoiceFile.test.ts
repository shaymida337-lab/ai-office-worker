import test from "node:test";
import assert from "node:assert/strict";
import {
  INVOICE_JSON_PARSE_FAILED_CODE,
  InvoiceJsonParseFailedError,
  resolveInvoiceScanJson,
} from "./claude.js";

const BROKEN_DIBBS_JSON = `\`\`\`json
{
  "supplier": "וולף דיבס טכנולוגיות בע"מ",
  "supplierTaxId": "516438231",
  "amount": 139,
  "vatAmount": 25.02,
  "totalAmount": 164.02,
  "date": "2025-03-05",
  "invoiceNumber": "40009107",
  "documentType": "tax_invoice_receipt",
  "paymentRequired": true,
  "currency": "ILS"
}
\`\`\``;

const VALID_DIBBS_JSON = `{
  "supplier": "וולף דיבס טכנולוגיות בע\\"מ",
  "supplierTaxId": "516438231",
  "amount": 139,
  "vatAmount": 25.02,
  "totalAmount": 164.02,
  "date": "2025-03-05",
  "invoiceNumber": "40009107",
  "documentType": "tax_invoice_receipt",
  "paymentRequired": true,
  "currency": "ILS"
}`;

test("analyzeInvoiceFile JSON retry: broken בע\"מ response then valid retry succeeds", async () => {
  let retryCalled = false;
  const parsed = await resolveInvoiceScanJson({
    primaryText: BROKEN_DIBBS_JSON,
    requestRetry: async () => {
      retryCalled = true;
      return VALID_DIBBS_JSON;
    },
  });

  assert.equal(retryCalled, true);
  assert.equal(parsed.supplier, 'וולף דיבס טכנולוגיות בע"מ');
  assert.equal(parsed.totalAmount, 164.02);
});

test("analyzeInvoiceFile JSON retry: both responses broken returns INVOICE_JSON_PARSE_FAILED", async () => {
  await assert.rejects(
    async () =>
      resolveInvoiceScanJson({
        primaryText: BROKEN_DIBBS_JSON,
        requestRetry: async () => BROKEN_DIBBS_JSON,
      }),
    (err: unknown) => {
      assert.ok(err instanceof InvoiceJsonParseFailedError);
      assert.equal(err.code, INVOICE_JSON_PARSE_FAILED_CODE);
      return true;
    }
  );
});
