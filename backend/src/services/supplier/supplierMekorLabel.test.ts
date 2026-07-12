import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSupplierFromMekorLabel,
  resolveSupplierWithMekorLabel,
} from "./supplierMekorLabel.js";

const TIK_TAK_OCR =
  '[מקור] טיק טק תקשורת, \u200ETA\u200F \u200Fלי \u200ESi\u200F \u200Fשה ותש מל מע = \u200E[EE\u200F \u200Fמ \u200Efrie\u200F \u200Fטא הוחו ו';

test("cmqe9kwdr OCR text → טיק טק תקשורת", () => {
  assert.equal(extractSupplierFromMekorLabel(TIK_TAK_OCR), "טיק טק תקשורת");
  assert.equal(
    resolveSupplierWithMekorLabel("חברת החשמל", TIK_TAK_OCR),
    "טיק טק תקשורת"
  );
});

test("document without [מקור] → no change", () => {
  const text = "חשבונית מס 12345\nסופר פארם בע\"מ";
  assert.equal(extractSupplierFromMekorLabel(text), null);
  assert.equal(resolveSupplierWithMekorLabel("סופר-פארם", text), "סופר-פארם");
});

test("[מקור] Unknown supplier → not accepted", () => {
  const text = "[מקור] Unknown supplier, invoice 123";
  assert.equal(extractSupplierFromMekorLabel(text), null);
  assert.equal(resolveSupplierWithMekorLabel("חברת החשמל", text), "חברת החשמל");
});

test("[מקור] with email → not accepted", () => {
  const text = "[מקור] billing@example.com, invoice 123";
  assert.equal(extractSupplierFromMekorLabel(text), null);
  assert.equal(resolveSupplierWithMekorLabel("בזק", text), "בזק");
});
