import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  extractDeterministicInvoiceFieldsFromPdfText,
  mergePdfTextDeterministicFields,
  mergePdfTextDeterministicIntoEmailAnalysis,
  type PdfTextEmailAnalysisMergeTarget,
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

test("merge into EmailAnalysis shape returns supplier amount date documentType currency", () => {
  const deterministic = extractDeterministicInvoiceFieldsFromPdfText(GREEN_INVOICE_PDF_TEXT);
  const emailAnalysis: PdfTextEmailAnalysisMergeTarget = {
    supplier: "לא ידוע",
    supplierTaxId: null,
    amount: 540,
    amountBeforeVat: 540,
    vatAmount: 97.2,
    totalAmount: 540,
    currency: "ILS",
    documentType: "receipt",
    paymentRequired: true,
    dueDate: null,
    invoiceDate: null,
    invoiceNumber: null,
    tasks: [],
    confidence: 0.5,
  };

  const merged = mergePdfTextDeterministicIntoEmailAnalysis(emailAnalysis, deterministic);

  assert.equal(merged.supplier, EXPECTED_GREEN.supplier);
  assert.equal(merged.amount, EXPECTED_GREEN.totalAmount);
  assert.equal(merged.totalAmount, EXPECTED_GREEN.totalAmount);
  assert.equal(merged.invoiceDate, EXPECTED_GREEN.documentDate);
  assert.equal(merged.documentType, EXPECTED_GREEN.documentType);
  assert.equal(merged.currency, EXPECTED_GREEN.currency);
  assert.deepEqual(merged.tasks, []);
  assert.equal(merged.paymentRequired, true);
  assert.equal(merged.confidence, 0.5);
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

test("final total wins over adjacent pre-VAT / subtotal lines (he + en)", () => {
  const heClear = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס
שם ספק: אלפא שירותים בע״מ
תאריך חשבונית: 15/06/2026
סה״כ לפני מע״מ ₪1,047.93
מע״מ 18% ₪186.63
₪1,234.56 סה״כ לתשלום`);
  assert.equal(heClear.totalAmount, 1234.56);

  const heTir = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס / קבלה
שם ספק: דלתא טכנולוגיות בע״מ
תאריך חשבונית: 12/06/2026
לפני מע״מ ₪500.00
מע״מ ₪90.00
₪590.00 סה״כ לתשלום`);
  assert.equal(heTir.totalAmount, 590);

  const enDue = extractDeterministicInvoiceFieldsFromPdfText(`Invoice
Supplier name: Beta Office Supplies Ltd
Invoice date: 2026-06-15
Subtotal 100.00
VAT 18.00
Total amount due $118.00 USD`);
  assert.equal(enDue.totalAmount, 118);

  const enTotal = extractDeterministicInvoiceFieldsFromPdfText(`Invoice
Supplier name: Zeta Media Group
Invoice date: 2026-06-01
Subtotal 95.00
Tax 19.00
Total amount 114.00 USD`);
  assert.equal(enTotal.totalAmount, 114);
});

test("Hebrew קבלה standalone line is receipt (no JS \\\\b dependency)", () => {
  const fields = extractDeterministicInvoiceFieldsFromPdfText(`קבלה
שם ספק: גמא קפה בע״מ
תאריך חשבונית: 10/06/2026
₪45.90 סה״כ לתשלום`);
  assert.equal(fields.documentType, "receipt");
});

test("financial invoice without supplier keeps supplierName null (metadata lines skipped)", () => {
  const fields = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס
תאריך חשבונית: 14/06/2026
מספר מסמך: SYN-NOSUP-001
שירות כללי
₪150.00 סה״כ לתשלום`);
  assert.equal(fields.supplierName, null);
  assert.equal(fields.totalAmount, 150);
  assert.equal(fields.documentDate, "2026-06-14");
  assert.equal(fields.documentType, "invoice");
  assert.equal(fields.currency, "ILS");
});

test("metadata labels are not suppliers; real names with שירותים still extract", () => {
  assert.equal(
    extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס
מספר קבלה: R-9
אסמכתא: REF-1
₪10.00 סה״כ לתשלום`).supplierName,
    null
  );

  const withServices = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס
שם ספק: אלפא שירותים בע״מ
תאריך חשבונית: 15/06/2026
₪100.00 סה״כ לתשלום`);
  assert.equal(withServices.supplierName, "אלפא שירותים בע״מ");
});

test("negative invoice mentions do not invent a supplier (en_non_financial)", () => {
  const fields = extractDeterministicInvoiceFieldsFromPdfText(`Team weekly sync agenda
Hello everyone,
Please join the Friday planning call.
No payment, no invoice, no receipt.
Topics: roadmap, hiring, snacks.`);
  assert.equal(fields.supplierName, null);
  assert.equal(fields.totalAmount, null);
  assert.equal(fields.documentType, null);
});

test("real Invoice / Tax Invoice / Invoice No. titles still extract following supplier", () => {
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
});

test("mid-sentence invoice word is not a supplier title anchor", () => {
  assert.equal(
    extractDeterministicInvoiceFieldsFromPdfText(`Please review the invoice attached below.
Topics: roadmap, hiring, snacks.`).supplierName,
    null
  );
});

test("חשבונית זיכוי / הודעת זיכוי beat generic invoice detection", () => {
  const creditInvoice = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית זיכוי
שם ספק: אפסילון לוגיסטיקה בע״מ
תאריך חשבונית: 08/06/2026
₪120.00 סה״כ לתשלום`);
  assert.equal(creditInvoice.documentType, "credit_note");

  const creditNotice = extractDeterministicInvoiceFieldsFromPdfText(`הודעת זיכוי
שם ספק: אפסילון לוגיסטיקה בע״מ
תאריך חשבונית: 08/06/2026
₪120.00 סה״כ לתשלום`);
  assert.equal(creditNotice.documentType, "credit_note");

  const taxInvoice = extractDeterministicInvoiceFieldsFromPdfText(`חשבונית מס
שם ספק: אלפא שירותים בע״מ
תאריך חשבונית: 15/06/2026
₪100.00 סה״כ לתשלום`);
  assert.equal(taxInvoice.documentType, "invoice");
});
