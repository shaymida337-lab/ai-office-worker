import assert from "node:assert/strict";
import test from "node:test";
import {
  assessInvoiceCompleteness,
  filterInvoicesByCompleteness,
  INVOICE_COMPLETION_REASON,
  isInvoiceRecordApproved,
  parseInvoiceCompletenessParam,
} from "./invoiceCompleteness.js";

const completeBase = {
  supplierName: "אונדו",
  amount: 120,
  amountResolved: true,
  currency: "ILS",
  currencyExplicit: true,
  date: new Date("2026-06-01"),
  documentDateExplicit: true,
  documentType: "invoice",
  reviewStatus: "approved",
  rawReviewStatus: "approved",
  confidenceScore: "high",
};

test("assessInvoiceCompleteness marks fully approved invoice as complete", () => {
  const result = assessInvoiceCompleteness(completeBase);
  assert.equal(result.dataComplete, true);
  assert.equal(result.approvalRequired, false);
  assert.equal(result.isComplete, true);
  assert.deepEqual(result.missingDataReasons, []);
  assert.deepEqual(result.approvalReasons, []);
});

test("assessInvoiceCompleteness separates missing data from approval", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    confidenceScore: 0.6,
  });

  assert.equal(result.dataComplete, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.isComplete, false);
  assert.deepEqual(result.missingDataReasons, []);
  assert.ok(result.approvalReasons.includes(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED));
  assert.ok(result.approvalReasons.includes(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE));
});

test("assessInvoiceCompleteness lists explicit missing required fields", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    supplierName: "unknown",
    amount: null,
    amountResolved: false,
    currencyExplicit: false,
    documentDateExplicit: false,
    documentType: "unknown_needs_review",
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    confidenceScore: "low",
    parsedFieldsJson: { arc: { status: "ambiguous", selectedAmount: null, reasonCode: "AMBIGUOUS" } },
  });

  assert.equal(result.dataComplete, false);
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED));
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MISSING_AMOUNT));
  assert.ok(result.approvalReasons.includes(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED));
});

test("isInvoiceRecordApproved treats auto_saved as approved", () => {
  assert.equal(isInvoiceRecordApproved("auto_saved"), true);
  assert.equal(isInvoiceRecordApproved("needs_review"), false);
});

test("filterInvoicesByCompleteness splits lists without overlap", () => {
  const invoices = [
    { id: "a", isComplete: true },
    { id: "b", isComplete: false },
    { id: "c", isComplete: true },
  ];
  const complete = filterInvoicesByCompleteness(invoices, "complete");
  const incomplete = filterInvoicesByCompleteness(invoices, "incomplete");
  assert.deepEqual(complete.map((item) => item.id), ["a", "c"]);
  assert.deepEqual(incomplete.map((item) => item.id), ["b"]);
});

test("parseInvoiceCompletenessParam defaults to complete", () => {
  assert.equal(parseInvoiceCompletenessParam(undefined), "complete");
});
