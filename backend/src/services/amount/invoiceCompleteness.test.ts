import test from "node:test";
import assert from "node:assert/strict";
import {
  assessInvoiceCompleteness,
  filterInvoicesByCompleteness,
  INVOICE_COMPLETION_REASON,
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
  confidenceScore: "high",
};

test("assessInvoiceCompleteness marks fully approved invoice as complete", () => {
  const result = assessInvoiceCompleteness(completeBase);
  assert.equal(result.isComplete, true);
  assert.deepEqual(result.completionReasons, []);
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
    confidenceScore: "low",
    parsedFieldsJson: { arc: { status: "ambiguous", selectedAmount: null, reasonCode: "AMBIGUOUS" } },
  });

  assert.equal(result.isComplete, false);
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.MISSING_AMOUNT));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.MISSING_DATE));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.MISSING_CURRENCY));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS));
  assert.ok(result.completionReasons.includes(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE));
});

test("assessInvoiceCompleteness keeps needs_review invoice incomplete even when fields are filled", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    confidenceScore: 0.6,
  });

  assert.equal(result.isComplete, false);
  assert.deepEqual(result.completionReasons, [
    INVOICE_COMPLETION_REASON.USER_APPROVAL_REQUIRED,
    INVOICE_COMPLETION_REASON.LOW_CONFIDENCE,
  ]);
});

test("parseInvoiceCompletenessParam defaults to complete", () => {
  assert.equal(parseInvoiceCompletenessParam(undefined), "complete");
  assert.equal(parseInvoiceCompletenessParam("complete"), "complete");
  assert.equal(parseInvoiceCompletenessParam("incomplete"), "incomplete");
  assert.equal(parseInvoiceCompletenessParam("all"), "all");
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
