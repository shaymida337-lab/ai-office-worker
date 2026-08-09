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
  confidenceScore: "high" as string | number,
};

test("assessInvoiceCompleteness marks fully approved invoice as complete", () => {
  const result = assessInvoiceCompleteness(completeBase);
  assert.equal(result.dataComplete, true);
  assert.equal(result.approvalRequired, false);
  assert.equal(result.isComplete, true);
  assert.deepEqual(result.missingDataReasons, []);
  assert.deepEqual(result.approvalReasons, []);
});

test("assessInvoiceCompleteness separates missing data from approval — review ≠ incomplete", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    confidenceScore: 0.6,
  });

  assert.equal(result.dataComplete, true);
  assert.equal(result.approvalRequired, true);
  // Screen routing follows data completeness, not approvalRequired.
  assert.equal(result.isComplete, true);
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
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS));
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

// --- Routing regression: Data Completeness ≠ Human Review ---

test("routing: Complete + needs_review → חשבוניות (isComplete)", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    confidenceScore: "low",
  });
  assert.equal(result.dataComplete, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.isComplete, true);
  const routed = filterInvoicesByCompleteness([{ id: "x", isComplete: result.isComplete }], "complete");
  assert.equal(routed.length, 1);
});

test("routing: Complete + auto_saved → חשבוניות", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "auto_saved",
    rawReviewStatus: "auto_saved",
  });
  assert.equal(result.isComplete, true);
  assert.equal(result.approvalRequired, false);
});

test("routing: Missing supplier → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    supplierName: null,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.SUPPLIER_UNIDENTIFIED));
});

test("routing: Missing amount → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    amount: null,
    amountResolved: false,
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MISSING_AMOUNT));
});

test("routing: Missing date → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    documentDateExplicit: false,
    date: null,
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MISSING_DATE));
});

test("routing: Duplicate unsure → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    decisionReason: "Held for review: possible duplicate / duplicate.semantic_unsure",
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE));
});

test("routing: Structured duplicate unsure → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    decisionReason: null,
    parsedFieldsJson: {
      gates: [
        {
          gate: "duplicate",
          verdict: "review",
          reasonCode: "duplicate.semantic_unsure",
          engineVersion: "duplicate-gate-v1",
          matchedPaymentId: "pay-1",
          matchedReviewId: null,
          matchStrength: "unsure",
        },
      ],
    },
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE));
});

test("routing: Structured duplicate confirmed → לא חשבונית רגילה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    decisionReason: null,
    parsedFieldsJson: {
      gates: [
        {
          gate: "duplicate",
          verdict: "block",
          reasonCode: "duplicate.confirmed_match",
          engineVersion: "duplicate-gate-v1",
          matchedPaymentId: "pay-1",
          matchedReviewId: null,
          matchStrength: "confirmed",
        },
      ],
    },
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_CONFIRMED));
});

test("routing: No duplicate signal → לא נחסם בטעות", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    decisionReason: "Held for glance only",
    parsedFieldsJson: {
      gates: [
        {
          gate: "duplicate",
          verdict: "pass",
          reasonCode: "duplicate.none",
          engineVersion: "duplicate-gate-v1",
          matchedPaymentId: null,
          matchedReviewId: null,
          matchStrength: "none",
        },
      ],
    },
  });
  assert.equal(result.isComplete, true);
  assert.equal(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE), false);
  assert.equal(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_CONFIRMED), false);
});

test("routing: Text duplicate fallback only when no structured gate", () => {
  const withStructuredPassIgnoresText = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    decisionReason: "possible duplicate / duplicate.semantic_unsure",
    parsedFieldsJson: {
      gates: [
        {
          gate: "duplicate",
          verdict: "pass",
          reasonCode: "duplicate.none",
          engineVersion: "duplicate-gate-v1",
          matchedPaymentId: null,
          matchedReviewId: null,
          matchStrength: "none",
        },
      ],
    },
  });
  assert.equal(withStructuredPassIgnoresText.isComplete, true);
  assert.equal(
    withStructuredPassIgnoresText.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE),
    false,
  );

  const textOnlyFallback = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    decisionReason: "possible duplicate / duplicate.semantic_unsure",
    parsedFieldsJson: { note: "no gates array" },
  });
  assert.equal(textOnlyFallback.isComplete, false);
  assert.ok(textOnlyFallback.missingDataReasons.includes(INVOICE_COMPLETION_REASON.DUPLICATE_UNSURE));
});

test("routing: Camera complete data + draft/needs confirmation → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    ingestSource: "camera",
  });
  assert.equal(result.isComplete, false);
  assert.equal(result.dataComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.CAMERA_UNCONFIRMED));
});

test("routing: Camera complete data + confirmed/approved → חשבוניות", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "approved",
    rawReviewStatus: "approved",
    ingestSource: "camera",
  });
  assert.equal(result.isComplete, true);
  assert.equal(result.dataComplete, true);
  assert.equal(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.CAMERA_UNCONFIRMED), false);
});

test("policy lock: supplier+amount+date+known type without currencyExplicit → still השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    currency: "ILS",
    currencyExplicit: false,
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MISSING_CURRENCY));
});

test("routing: Unknown document type → השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    documentType: "unknown_needs_review",
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MISSING_DOCUMENT_TYPE));
});

test("routing: amount ambiguity alone → השלמה even when fields look filled", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    parsedFieldsJson: { arc: { status: "ambiguous", selectedAmount: null, reasonCode: "AMBIGUOUS" } },
  });
  assert.equal(result.isComplete, false);
  assert.ok(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.MULTIPLE_AMOUNTS));
});

test("routing: low confidence alone does not send data-complete doc to השלמה", () => {
  const result = assessInvoiceCompleteness({
    ...completeBase,
    reviewStatus: "needs_review",
    rawReviewStatus: "needs_review",
    confidenceScore: "low",
  });
  assert.equal(result.isComplete, true);
  assert.ok(result.approvalReasons.includes(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE));
  assert.equal(result.missingDataReasons.includes(INVOICE_COMPLETION_REASON.LOW_CONFIDENCE), false);
});
