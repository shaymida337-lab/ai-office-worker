import test from "node:test";
import assert from "node:assert/strict";
import { resolveExtractedDocumentFinancial } from "./financialDocumentClassification.js";

const WOLT_PDF_SNIPPET = `1 / 2
266275049 מספר (מקור) חשבונית מס / קבלה
פרטי ההזמנה
שם לקוח\tShay Mida
תאריך הפקה\t23:05 30.05.2026
Visa: ****3651\t146.90
פריט\tמע"מ %\tכמות\tמחיר יחידה\tמחיר`;

const RENDER_PDF_SNIPPET = `Page 1 of 1
Invoice
Invoice number JR6EXLMO-0001
Date of issue June 5, 2026
Render Services, Inc dba Render
$4.38 USD due June 5, 2026
Description \tQty \tUnit price \tAmount`;

const MAY_RAMAT_GAN_OCR = "‎@7F 2006‏ > מ .. - הממפפם ₪";

const MAX_LOGO_OCR =
  "| מק הלכי ae Se TR = es =n Seems Te = = נאן קונים גביף ee Ter phe 1227777 MAX מס/קבלה 79653";

const AMPM_LOGO_OCR =
  "city market ey או TRE he אמ SS CI Ee == ה Ee SET ow @ See = ניהו? מתחמים קמעונאיים בען הת ססרה קבלה";

test("golden cmqx6suha04hxjx2dq2y71tgt Wolt receipt stays financial despite missing supplier", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "receipt",
      supplierName: "לא ידוע",
      totalAmount: 146.9,
      pdfText: WOLT_PDF_SNIPPET,
      filename: "wolt.pdf",
      mimeType: "application/pdf",
    }),
    true
  );
});

test("golden cmqfo9kvk02lvnf2dv9jx9b57 Render invoice stays financial", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "invoice",
      supplierName: "Render Services, Inc",
      totalAmount: 4.38,
      pdfText: RENDER_PDF_SNIPPET,
      filename: "Invoice-JR6EXLMO-0001.pdf",
      mimeType: "application/pdf",
    }),
    true
  );
});

test("service bill מי רמת גן → financial=true", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "other",
      supplierName: "חברת החשמל",
      totalAmount: null,
      ocrText: MAY_RAMAT_GAN_OCR,
      filename: "image0.png",
      mimeType: "image/png",
      ocrConfidence: 0.63,
    }),
    true
  );
});

test("Render notification → false", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "other",
      supplierName: "Unknown supplier",
      totalAmount: 4,
      bodyText:
        "Held for review: blocked non-invoice message: Render notification / documentType is unknown_needs_review / confidence below 80% (0%); Quarantined: cross-org gmail ingestion",
      filename: "email-only",
    }),
    false
  );
});

test("test email with technical supplier → false", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "other",
      supplierName: "approved /api/ PLUS /api/ results and /api/ (when no st",
      totalAmount: 1,
      bodyText:
        "Held for review: blocked non-invoice message: support/test email / documentType is unknown_needs_review / confidence below 80% (0%); Quarantined: cross-org gmail ingestion",
      filename: "email-only",
    }),
    false
  );
});

test("logo only → false", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "receipt",
      supplierName: "MAX",
      totalAmount: 43.6,
      ocrText: MAX_LOGO_OCR,
      filename: "image0.jpeg",
      mimeType: "image/jpeg",
      ocrConfidence: 0.45,
    }),
    false
  );
});

test("logo subject hint blocks financial even with receipt-like OCR", () => {
  assert.equal(
    resolveExtractedDocumentFinancial({
      documentType: "receipt",
      supplierName: "MAX",
      totalAmount: 43.6,
      subject: "חשבונית לוקו מקס",
      ocrText: MAX_LOGO_OCR,
      filename: "image0.jpeg",
      mimeType: "image/jpeg",
    }),
    false
  );
});
