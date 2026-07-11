import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInvoiceCompletionSourceType,
  stripInvoiceCompletionId,
  validateApproveAllowed,
  mapCompletionErrorStatus,
} from "./invoiceCompletionAction.js";
import { assessInvoiceCompleteness, INVOICE_COMPLETION_REASON } from "./amount/invoiceCompleteness.js";

test("parseInvoiceCompletionSourceType accepts canonical and legacy aliases", () => {
  assert.equal(parseInvoiceCompletionSourceType("gmail-scan-item"), "gmail-scan-item");
  assert.equal(parseInvoiceCompletionSourceType("gmail_scan_item"), "gmail-scan-item");
  assert.equal(parseInvoiceCompletionSourceType("document-review"), "document-review");
  assert.equal(parseInvoiceCompletionSourceType("supplier-payment"), "supplier-payment");
  assert.equal(parseInvoiceCompletionSourceType("invoice"), null);
});

test("stripInvoiceCompletionId removes known prefixes", () => {
  assert.equal(stripInvoiceCompletionId("gmail-scan:abc"), "abc");
  assert.equal(stripInvoiceCompletionId("document-review:abc"), "abc");
  assert.equal(stripInvoiceCompletionId("supplier-payment:abc"), "abc");
  assert.equal(stripInvoiceCompletionId("abc"), "abc");
});

test("validateApproveAllowed rejects incomplete data with Hebrew message", () => {
  const assessment = assessInvoiceCompleteness({
    supplierName: "unknown",
    amount: null,
    amountResolved: false,
    currency: "ILS",
    currencyExplicit: true,
    date: new Date("2026-06-01"),
    documentDateExplicit: true,
    documentType: "invoice",
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
  });

  assert.throws(
    () => validateApproveAllowed(assessment),
    (err: unknown) => err instanceof Error && err.message.startsWith("לא ניתן לאשר"),
  );
});

test("validateApproveAllowed allows data-complete record awaiting approval", () => {
  const assessment = assessInvoiceCompleteness({
    supplierName: "אונדו",
    amount: 49.74,
    amountResolved: true,
    currency: "ILS",
    currencyExplicit: true,
    date: new Date("2026-08-28"),
    documentDateExplicit: true,
    documentType: "invoice",
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
  });

  assert.doesNotThrow(() => validateApproveAllowed(assessment));
  assert.equal(assessment.dataComplete, true);
  assert.equal(assessment.approvalRequired, true);
});

test("mapCompletionErrorStatus maps domain errors to HTTP statuses", () => {
  assert.equal(mapCompletionErrorStatus("Gmail scan item not found"), 404);
  assert.equal(mapCompletionErrorStatus("המסמך חסום לעריכה"), 403);
  assert.equal(mapCompletionErrorStatus("לא ניתן לאשר — חסר סכום"), 422);
});

test("complete data + needs_review maps to approve button scenario", () => {
  const assessment = assessInvoiceCompleteness({
    supplierName: "אונדו",
    amount: 49.74,
    amountResolved: true,
    currency: "ILS",
    currencyExplicit: true,
    date: new Date("2026-08-28"),
    documentDateExplicit: true,
    documentType: "invoice",
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
  });

  assert.equal(assessment.isComplete, false);
  assert.ok(assessment.approvalReasons.includes(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED));
  assert.deepEqual(assessment.missingDataReasons, []);
});
