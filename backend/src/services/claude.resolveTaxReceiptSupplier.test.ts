import test from "node:test";
import assert from "node:assert/strict";
import {
  ocrHintForPrompt,
  resolveTaxReceiptSupplier,
} from "./claude.js";

test("ocrHintForPrompt omits low-confidence Tesseract junk", () => {
  const junk = "WLBT Hadar xyz 123";
  assert.equal(ocrHintForPrompt(junk, 0.41), "");
  assert.match(ocrHintForPrompt(junk, 0.7), /WLBT/);
});

test("resolveTaxReceiptSupplier drops וולט הדר when OCR has no Wolt", () => {
  assert.equal(
    resolveTaxReceiptSupplier({
      extractedSupplier: "וולט הדר",
      ocrText: "WLBT random garbage",
      ocrConfidence: 0.41,
      documentType: "tax_invoice_receipt",
    }),
    null,
  );
});

test("resolveTaxReceiptSupplier keeps מה יוסי פיצוחי", () => {
  assert.equal(
    resolveTaxReceiptSupplier({
      extractedSupplier: "מה יוסי פיצוחי",
      ocrText: "WLBT junk",
      documentType: "tax_invoice_receipt",
    }),
    "מה יוסי פיצוחי",
  );
});

test("resolveTaxReceiptSupplier keeps real Wolt when OCR mentions Wolt", () => {
  assert.equal(
    resolveTaxReceiptSupplier({
      extractedSupplier: "וולט",
      ocrText: "Wolt Enterprises Israel",
      documentType: "tax_invoice_receipt",
    }),
    "וולט",
  );
});

test("resolveTaxReceiptSupplier drops וולט הדר even without OCR text", () => {
  assert.equal(
    resolveTaxReceiptSupplier({
      extractedSupplier: "וולט הדר",
      ocrText: null,
      documentType: "receipt",
    }),
    null,
  );
});
