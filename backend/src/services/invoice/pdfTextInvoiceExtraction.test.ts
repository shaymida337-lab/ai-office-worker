import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  extractDeterministicInvoiceFieldsFromPdfText,
  mergePdfTextDeterministicFields,
} from "./pdfTextInvoiceExtraction.js";

const GREEN_INVOICE_PDF_TEXT = `הופק ב 20/06/2026 00:25 | חשבונית מס / קבלה 84878611 | עמוד 1 מתוך 1
חשבונית ירוקה
עוסק מורשה )ח.פ(: 514756428
שם, תל אביב - יפו
לכבוד:
ai-office-worker
035807064 פ/ת.ז.ח
רכישת מינוי Best שנתי
סה"כ מחיר פירוט כמות
₪540.00 ₪540.00 רכישת מינוי Best שנתי 1
₪540.00 סה"כ
₪97.20 מע"מ 18%
₪637.20 סה"כ לתשלום
פרטי תשלומים
סכום תאריך פירוט אמצעי תשלום
₪637.20 20/06/2026 ויזה 0008 / רגיל כרטיס אשראי
₪637.20 סה"כ
20/07/2027 - 21/07/2026 :תקופת חיוב
מקור חשבונית מס / קבלה 84878611
20/06/2026`;

const EXPECTED_GREEN = {
  supplier: "חשבונית ירוקה",
  totalAmount: 637.2,
  documentDate: "2026-06-20",
  documentType: "tax_invoice_receipt" as const,
  currency: "ILS",
};

function assertGreenInvoiceFields(fields: ReturnType<typeof extractDeterministicInvoiceFieldsFromPdfText>) {
  assert.equal(fields.supplierName, EXPECTED_GREEN.supplier);
  assert.equal(fields.totalAmount, EXPECTED_GREEN.totalAmount);
  assert.equal(fields.documentDate, EXPECTED_GREEN.documentDate);
  assert.equal(fields.documentType, EXPECTED_GREEN.documentType);
  assert.equal(fields.currency, EXPECTED_GREEN.currency);
}

test("84878611.pdf deterministic extraction returns stable critical fields", () => {
  assertGreenInvoiceFields(extractDeterministicInvoiceFieldsFromPdfText(GREEN_INVOICE_PDF_TEXT));
});

test("84878611.pdf deterministic fields win over wrong Claude merge", () => {
  const deterministic = extractDeterministicInvoiceFieldsFromPdfText(GREEN_INVOICE_PDF_TEXT);
  const wrongClaude = {
    supplier: "לא ידוע",
    amount: 540,
    totalAmount: 540,
    currency: "ILS",
    documentType: "receipt" as const,
    invoiceDate: null,
  };
  const merged = mergePdfTextDeterministicFields(wrongClaude, deterministic);
  assert.equal(merged.supplier, EXPECTED_GREEN.supplier);
  assert.equal(merged.totalAmount, EXPECTED_GREEN.totalAmount);
  assert.equal(merged.invoiceDate, EXPECTED_GREEN.documentDate);
  assert.equal(merged.documentType, EXPECTED_GREEN.documentType);
  assert.equal(merged.currency, EXPECTED_GREEN.currency);
});

test("84878611.pdf regression: 3 consecutive runs stay identical", () => {
  for (let run = 1; run <= 3; run++) {
    const deterministic = extractDeterministicInvoiceFieldsFromPdfText(GREEN_INVOICE_PDF_TEXT);
    assertGreenInvoiceFields(deterministic);
    const merged = mergePdfTextDeterministicFields(
      {
        supplier: "לא ידוע",
        amount: 540,
        totalAmount: 540,
        currency: "ILS",
        documentType: "receipt",
        invoiceDate: null,
      },
      deterministic
    );
    assert.equal(merged.supplier, EXPECTED_GREEN.supplier, `run ${run} supplier`);
    assert.equal(merged.totalAmount, EXPECTED_GREEN.totalAmount, `run ${run} totalAmount`);
    assert.equal(merged.invoiceDate, EXPECTED_GREEN.documentDate, `run ${run} documentDate`);
    assert.equal(merged.documentType, EXPECTED_GREEN.documentType, `run ${run} documentType`);
    assert.equal(merged.currency, EXPECTED_GREEN.currency, `run ${run} currency`);
  }
});

test("84878611.pdf live PDF text extraction matches expected fields", async () => {
  const pdfPath = join(
    process.cwd(),
    "..",
    ".evidence-invoice-v2/benchmark-files/cmqlhigoz001fgm2d634udlfh__84878611.pdf"
  );
  const buffer = readFileSync(pdfPath);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    assertGreenInvoiceFields(extractDeterministicInvoiceFieldsFromPdfText(result.text ?? ""));
  } finally {
    await parser.destroy().catch(() => undefined);
  }
});

test("non-PDF email body is not affected by deterministic merge", () => {
  const merged = mergePdfTextDeterministicFields(
    {
      supplier: "בזק",
      amount: 100,
      totalAmount: 100,
      currency: "ILS",
      documentType: "invoice",
      invoiceDate: "2026-01-01",
    },
    null
  );
  assert.equal(merged.supplier, "בזק");
  assert.equal(merged.totalAmount, 100);
});
