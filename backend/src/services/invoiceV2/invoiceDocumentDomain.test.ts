import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIdempotencyKey,
  type InvoiceDocument,
  transitionInvoiceDocument,
  validateInvoiceDocument,
} from "./invoiceDocumentDomain.js";

const CALIBRATED_THRESHOLD = 0.85;

function baseDocument(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  const now = "2026-07-12T00:00:00.000Z";
  return {
    id: "doc-1",
    organizationId: "org-1",
    source: "gmail",
    sourceMessageId: "msg-1",
    attachmentHash: "hash-1",
    supplierName: "אונדו",
    totalAmount: 120,
    documentDate: "2026-06-01T00:00:00.000Z",
    documentType: "invoice",
    currency: "ILS",
    invoiceNumber: "INV-1",
    confidenceByField: {
      supplierName: 0.95,
      totalAmount: 0.95,
      documentDate: 0.95,
      documentType: 0.95,
      currency: 0.95,
      invoiceNumber: 0.9,
    },
    validationIssues: [],
    status: "EXTRACTED",
    originalFileUrl: null,
    approvedAt: null,
    approvedBy: null,
    extractionVersion: "v2.0.0",
    createdAt: now,
    updatedAt: now,
    processingAttempts: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastProcessedAt: null,
    ...overrides,
  };
}

test("missing currency routes to NEEDS_COMPLETION", () => {
  const result = validateInvoiceDocument(
    baseDocument({
      currency: null,
      confidenceByField: {
        ...baseDocument().confidenceByField,
        currency: 0.2,
      },
    }),
    { fieldConfidenceThreshold: CALIBRATED_THRESHOLD }
  );

  assert.equal(result.dataComplete, false);
  assert.equal(result.nextStatus, "NEEDS_COMPLETION");
  assert.ok(result.validationIssues.includes("MISSING_CURRENCY"));
});

test("supplier email is flagged as SUPPLIER_PLACEHOLDER and routes to NEEDS_COMPLETION", () => {
  const result = validateInvoiceDocument(
    baseDocument({
      supplierName: "vendor@example.com",
    }),
    { fieldConfidenceThreshold: CALIBRATED_THRESHOLD }
  );

  assert.ok(result.validationIssues.includes("SUPPLIER_PLACEHOLDER"));
  assert.equal(result.dataComplete, false);
  assert.equal(result.nextStatus, "NEEDS_COMPLETION");
  assert.equal(result.canAutoApprove, false);
});

test("missing amount routes to NEEDS_COMPLETION", () => {
  const result = validateInvoiceDocument(
    baseDocument({
      totalAmount: null,
    }),
    { fieldConfidenceThreshold: CALIBRATED_THRESHOLD }
  );

  assert.equal(result.dataComplete, false);
  assert.equal(result.nextStatus, "NEEDS_COMPLETION");
  assert.ok(result.validationIssues.includes("MISSING_AMOUNT"));
});

test("amount anomaly routes to NEEDS_APPROVAL and not APPROVED", () => {
  const result = validateInvoiceDocument(
    baseDocument({
      validationIssues: ["AMOUNT_ANOMALY"],
    }),
    { fieldConfidenceThreshold: CALIBRATED_THRESHOLD }
  );

  assert.equal(result.dataComplete, true);
  assert.equal(result.canAutoApprove, false);
  assert.equal(result.nextStatus, "NEEDS_APPROVAL");
  assert.ok(result.validationIssues.includes("AMOUNT_ANOMALY"));
  assert.notEqual(result.nextStatus, "APPROVED");
});

test("complete document with low confidence routes to NEEDS_APPROVAL", () => {
  const result = validateInvoiceDocument(
    baseDocument({
      confidenceByField: {
        ...baseDocument().confidenceByField,
        supplierName: 0.4,
      },
    }),
    { fieldConfidenceThreshold: CALIBRATED_THRESHOLD }
  );

  assert.equal(result.dataComplete, true);
  assert.equal(result.canAutoApprove, false);
  assert.equal(result.nextStatus, "NEEDS_APPROVAL");
  assert.ok(result.validationIssues.includes("LOW_CONFIDENCE_SUPPLIER"));
});

test("complete verified document can auto-approve to APPROVED with calibrated threshold", () => {
  const result = validateInvoiceDocument(baseDocument(), {
    fieldConfidenceThreshold: CALIBRATED_THRESHOLD,
  });

  assert.equal(result.dataComplete, true);
  assert.equal(result.canAutoApprove, true);
  assert.equal(result.nextStatus, "APPROVED");
  assert.deepEqual(result.validationIssues, []);
});

test("without calibrated threshold auto-approval is disabled", () => {
  const result = validateInvoiceDocument(baseDocument());

  assert.equal(result.dataComplete, true);
  assert.equal(result.canAutoApprove, false);
  assert.equal(result.nextStatus, "NEEDS_APPROVAL");
});

test("APPROVED cannot be changed directly", () => {
  const approved = baseDocument({
    status: "APPROVED",
    approvedAt: "2026-07-12T01:00:00.000Z",
    approvedBy: "user-1",
  });

  const approveAttempt = transitionInvoiceDocument(approved, {
    kind: "approve",
    approvedBy: "user-2",
  });
  assert.equal(approveAttempt.ok, false);

  const rejectAttempt = transitionInvoiceDocument(approved, { kind: "reject" });
  assert.equal(rejectAttempt.ok, false);

  const validationAttempt = transitionInvoiceDocument(approved, { kind: "run_validation" });
  assert.equal(validationAttempt.ok, false);
});

test("EXTRACTED does not remain after validation completes", () => {
  const extracted = baseDocument({ status: "EXTRACTED" });
  const transition = transitionInvoiceDocument(extracted, {
    kind: "run_validation",
    options: { fieldConfidenceThreshold: CALIBRATED_THRESHOLD },
  });

  assert.equal(transition.ok, true);
  if (transition.ok) {
    assert.notEqual(transition.document.status, "EXTRACTED");
  }
});

test("approvedAt and approvedBy exist only in APPROVED", () => {
  const fixedNow = "2026-07-12T02:00:00.000Z";
  const needsApproval = transitionInvoiceDocument(
    baseDocument({ status: "NEEDS_APPROVAL" }),
    { kind: "reject" },
    { now: () => fixedNow }
  );
  assert.equal(needsApproval.ok, true);
  if (needsApproval.ok) {
    assert.equal(needsApproval.document.approvedAt, null);
    assert.equal(needsApproval.document.approvedBy, null);
  }

  const approved = transitionInvoiceDocument(
    baseDocument({ status: "NEEDS_APPROVAL" }),
    {
      kind: "approve",
      approvedBy: "user-1",
      options: { fieldConfidenceThreshold: CALIBRATED_THRESHOLD },
    },
    { now: () => fixedNow }
  );
  assert.equal(approved.ok, true);
  if (approved.ok) {
    assert.equal(approved.document.status, "APPROVED");
    assert.equal(approved.document.approvedAt, fixedNow);
    assert.equal(approved.document.approvedBy, "user-1");
  }
});

test("retry keeps the same idempotency key and status while incrementing processingAttempts", () => {
  const document = baseDocument({ status: "NEEDS_COMPLETION", processingAttempts: 2 });
  const keyBefore = buildIdempotencyKey(document);

  const firstRetry = transitionInvoiceDocument(document, { kind: "retry" }, { now: () => "2026-07-12T03:00:00.000Z" });
  const secondRetry = transitionInvoiceDocument(
    firstRetry.ok ? firstRetry.document : document,
    { kind: "retry" },
    { now: () => "2026-07-12T04:00:00.000Z" }
  );

  assert.equal(firstRetry.ok, true);
  assert.equal(secondRetry.ok, true);
  if (firstRetry.ok && secondRetry.ok) {
    assert.equal(buildIdempotencyKey(firstRetry.document), keyBefore);
    assert.equal(buildIdempotencyKey(secondRetry.document), keyBefore);
    assert.equal(firstRetry.document.status, "NEEDS_COMPLETION");
    assert.equal(secondRetry.document.status, "NEEDS_COMPLETION");
    assert.equal(firstRetry.document.processingAttempts, 3);
    assert.equal(secondRetry.document.processingAttempts, 4);
  }
});

test("NOT_FINANCIAL cannot become APPROVED", () => {
  const notFinancial = baseDocument({ status: "NOT_FINANCIAL" });
  const validation = validateInvoiceDocument(notFinancial, {
    fieldConfidenceThreshold: CALIBRATED_THRESHOLD,
  });

  assert.equal(validation.nextStatus, "NOT_FINANCIAL");
  assert.equal(validation.canAutoApprove, false);
  assert.notEqual(validation.nextStatus, "APPROVED");

  const classifiedButNotUpdated = baseDocument({
    status: "CLASSIFYING",
    validationIssues: ["NOT_FINANCIAL_UNCERTAIN"],
  });
  const pendingValidation = validateInvoiceDocument(classifiedButNotUpdated, {
    fieldConfidenceThreshold: CALIBRATED_THRESHOLD,
  });

  assert.equal(pendingValidation.nextStatus, "NOT_FINANCIAL");
  assert.equal(pendingValidation.canAutoApprove, false);
});

test("processing error is preserved from upstream validation issues", () => {
  const result = validateInvoiceDocument(
    baseDocument({
      validationIssues: ["PROCESSING_ERROR"],
    }),
    { fieldConfidenceThreshold: CALIBRATED_THRESHOLD }
  );

  assert.ok(result.validationIssues.includes("PROCESSING_ERROR"));
  assert.equal(result.canAutoApprove, false);
  assert.equal(result.nextStatus, "NEEDS_APPROVAL");
});
