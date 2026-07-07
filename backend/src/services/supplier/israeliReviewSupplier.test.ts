import test from "node:test";
import assert from "node:assert/strict";

import {
  matchIsraeliSupplierFromOcrText,
  normalizeIsraeliReviewSupplierAlias,
} from "./israeliReviewSupplier.js";

test("normalizeIsraeliReviewSupplierAlias maps common OCR misreads", () => {
  assert.equal(normalizeIsraeliReviewSupplierAlias("פרייזון"), "פז");
  assert.equal(normalizeIsraeliReviewSupplierAlias("Paz"), "פז");
  assert.equal(normalizeIsraeliReviewSupplierAlias("פז ילו"), "פז");
  assert.equal(normalizeIsraeliReviewSupplierAlias("Israel Electric"), "חברת החשמל");
  assert.equal(normalizeIsraeliReviewSupplierAlias("IEC"), "חברת החשמל");
});

test("matchIsraeliSupplierFromOcrText detects Paz and IEC from document text", () => {
  assert.equal(
    matchIsraeliSupplierFromOcrText("קבלה תחנת פז דלן סה\"כ 215.14 yellow"),
    "פז"
  );
  assert.equal(
    matchIsraeliSupplierFromOcrText("חשבון חשמל חברת החשמל לישראל סכום לתשלום 326.32"),
    "חברת החשמל"
  );
});

test("matchIsraeliSupplierFromOcrText ignores incidental IEC mentions without bill context", () => {
  assert.equal(
    matchIsraeliSupplierFromOcrText("דרישת תשלום עיריית רמת גן אזכור חברת החשמל"),
    null
  );
  assert.equal(matchIsraeliSupplierFromOcrText("random iec noise in footer"), null);
});
