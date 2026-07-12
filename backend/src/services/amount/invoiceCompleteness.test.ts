import assert from "node:assert/strict";
import test from "node:test";
import {
  assessInvoiceCompleteness,
  filterInvoiceCompletionQueueCandidates,
  filterInvoicesByCompleteness,
  INVOICE_COMPLETION_REASON,
  isInvoiceRecordApproved,
  parseInvoiceCompletenessParam,
  shouldExcludeFromInvoiceCompletionQueue,
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

test("filterInvoiceCompletionQueueCandidates removes confidently not financial only", () => {
  const candidates = [
    {
      id: "keep-unknown",
      isComplete: false,
      supplierName: "דייטבוק",
      amount: null,
      documentType: "unknown_needs_review",
      decisionReason: "needs_review",
      confidenceScore: "low",
    },
    {
      id: "keep-receipt",
      isComplete: false,
      supplierName: "Unknown supplier",
      amount: 498.9,
      documentType: "receipt",
      decisionReason: "needs_review",
      confidenceScore: "low",
      attachmentFilename: "receipt.jpg",
    },
    {
      id: "drop-logo",
      isComplete: false,
      supplierName: "MAX",
      amount: 43.6,
      documentType: "receipt",
      decisionReason: "needs_review",
      confidenceScore: "low",
      attachmentFilename: "image0.jpeg",
      parsedFieldsJson: {
        ocrText:
          "| מק הלכי ae Se TR = es =n Seems Te = = נאן קונים גביף ee Ter phe 1227777 MAX מס/קבלה 79653",
      },
    },
    {
      id: "drop-blocked",
      isComplete: false,
      supplierName: "Unknown supplier",
      amount: 4,
      documentType: "other",
      decisionReason:
        "Held for review: blocked non-invoice message: Render notification / documentType is unknown_needs_review",
      attachmentFilename: "email-only",
    },
  ];

  const filtered = filterInvoiceCompletionQueueCandidates(candidates);
  assert.deepEqual(
    filtered.map((item) => item.id),
    ["keep-unknown", "keep-receipt"]
  );
  assert.equal(shouldExcludeFromInvoiceCompletionQueue(candidates[0]), false);
  assert.equal(shouldExcludeFromInvoiceCompletionQueue(candidates[3]), true);
});

test("completion queue filter keeps complete/incomplete lists disjoint", () => {
  const invoices = [
    {
      id: "complete",
      isComplete: true,
      supplierName: "אונדו",
      amount: 120,
      documentType: "invoice",
    },
    {
      id: "incomplete-financial",
      isComplete: false,
      supplierName: "בזק",
      amount: null,
      documentType: "invoice",
      decisionReason: "needs_review",
    },
    {
      id: "incomplete-logo",
      isComplete: false,
      supplierName: "MAX",
      amount: 43.6,
      documentType: "receipt",
      attachmentFilename: "image0.jpeg",
      parsedFieldsJson: {
        ocrText: "MAX logo only weak ocr without invoice anchors",
      },
      confidenceScore: 0.45,
    },
  ];

  const completeOnly = filterInvoicesByCompleteness(invoices, "complete");
  const incompleteOnly = filterInvoiceCompletionQueueCandidates(
    filterInvoicesByCompleteness(invoices, "incomplete")
  );
  assert.deepEqual(completeOnly.map((item) => item.id), ["complete"]);
  assert.deepEqual(incompleteOnly.map((item) => item.id), ["incomplete-financial"]);
  assert.equal(
    completeOnly.some((item) => incompleteOnly.some((other) => other.id === item.id)),
    false
  );
});
