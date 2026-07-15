import test from "node:test";
import assert from "node:assert/strict";

import { gmailSupplierPaymentListVisibilityDates } from "./gmail-sync.js";

test("gmail SupplierPayment write stamps normalizedDocumentDate like camera confirm", () => {
  const documentDate = new Date("2026-05-30T00:00:00.000Z");
  const dates = gmailSupplierPaymentListVisibilityDates(documentDate);

  assert.equal(dates.date, documentDate);
  assert.equal(dates.normalizedDocumentDate, documentDate);
  assert.ok(dates.normalizedDocumentDate instanceof Date);
});
