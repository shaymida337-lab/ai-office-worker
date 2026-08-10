import assert from "node:assert/strict";
import test from "node:test";
import { assessPdfTextQuality, formatPageMarkedText, splitPdfTextIntoPages } from "./pdfTextQuality.js";

test("Delivery 9: garbled replacement characters are unusable", () => {
  const result = assessPdfTextQuality("���� ���� ����");
  assert.equal(result.verdict, "garbled");
  assert.equal(result.reasonCode, "REPLACEMENT_CHARACTERS");
});

test("Delivery 9: repeated junk digits are insufficient", () => {
  const result = assessPdfTextQuality("1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1");
  assert.equal(result.verdict, "insufficient");
  assert.equal(result.reasonCode, "REPEATED_JUNK");
});

test("Delivery 9: clear financial English text is usable", () => {
  const result = assessPdfTextQuality("Invoice 123 Total $150 Date 2026-08-01 Supplier Beta Ltd");
  assert.equal(result.verdict, "usable");
  assert.equal(result.reasonCode, "USABLE");
  assert.equal(result.hasFinancialKeywordEvidence, true);
});

test("Delivery 9: Hebrew invoice text is usable", () => {
  const result = assessPdfTextQuality(
    'חשבונית מס\nספק: אלפא בע"מ\nתאריך: 15/06/2026\nסה"כ לתשלום: ₪1,234.56'
  );
  assert.equal(result.verdict, "usable");
});

test("Delivery 9: empty text is garbled/empty", () => {
  const result = assessPdfTextQuality("");
  assert.equal(result.verdict, "garbled");
  assert.equal(result.reasonCode, "EMPTY");
});

test("Delivery 9: splitPdfTextIntoPages preserves multi-page content", () => {
  const pages = splitPdfTextIntoPages("Page one supplier\n\fPage two TOTAL 1180");
  assert.equal(pages.length, 2);
  assert.match(pages[0], /supplier/);
  assert.match(pages[1], /TOTAL/);
});

test("Delivery 9: formatPageMarkedText preserves page provenance", () => {
  const marked = formatPageMarkedText([
    { pageIndex: 0, text: "Supplier: Vendor ABC" },
    { pageIndex: 1, text: "TOTAL: 1180" },
  ]);
  assert.match(marked, /--- PAGE 1 ---/);
  assert.match(marked, /--- PAGE 2 ---/);
  assert.match(marked, /Vendor ABC/);
  assert.match(marked, /1180/);
});
