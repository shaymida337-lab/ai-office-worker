import test from "node:test";
import assert from "node:assert/strict";
import {
  approveFinancialDocumentReview,
  buildReviewDecision,
  evaluateReviewApprovalReadiness,
} from "./financialDocuments.js";
import { buildPassingTrustGateSnapshots } from "./trust/trustGatePersistence.js";
import { prisma } from "../lib/prisma.js";

const ORG = "org-readiness";

function buildReadyReview(overrides: Record<string, unknown> = {}) {
  const snapshots = buildPassingTrustGateSnapshots({
    amountGate: { normalizedAmount: 993.33 },
    supplierGate: { canonicalSupplierName: "Acme Ltd" },
  });
  return {
    id: "review-ready-1",
    organizationId: ORG,
    source: "gmail",
    sender: "billing@acme.example",
    subject: "Invoice",
    fileName: "inv.pdf",
    fileSize: 100,
    supplierName: "Acme Ltd",
    supplierTaxId: null,
    invoiceNumber: "INV-77",
    documentDate: new Date("2026-07-01T00:00:00.000Z"),
    dueDate: null,
    amountBeforeVat: null,
    vatAmount: null,
    totalAmount: 993.33,
    documentType: "tax_invoice",
    driveFileUrl: "https://drive.test/inv.pdf",
    driveUploadStatus: "uploaded",
    confidenceScore: 0.9,
    reviewStatus: "needs_review",
    uncertaintyReason: null,
    sourceFingerprint: "source-fp-r1",
    documentFingerprint: "doc-fp-r1",
    parsedFieldsJson: {
      gates: [snapshots.amountGate, snapshots.supplierGate, snapshots.fingerprintGate, snapshots.duplicateGate],
      sir: {
        status: "resolved",
        canonicalSupplier: "Acme Ltd",
        supplierName: "Acme Ltd",
        isStrongEnoughForAutoSave: true,
      },
    },
    rawAnalysis: null,
    emailMessageId: "email-r1",
    gmailMessageId: "gmail-r1",
    whatsappLogId: null,
    supplierPaymentId: null,
    currency: "ILS",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    normalizedDocumentDate: null,
    ...overrides,
  };
}

function withPrismaMocks<T>(
  review: Record<string, unknown>,
  fn: (state: { updateCalled: boolean; upsertCalled: boolean }) => Promise<T>
): Promise<T> {
  const original = {
    findFirst: prisma.financialDocumentReview.findFirst,
    update: prisma.financialDocumentReview.update,
    paymentFindMany: prisma.supplierPayment.findMany,
    paymentFindFirst: prisma.supplierPayment.findFirst,
    paymentUpsert: prisma.supplierPayment.upsert,
    auditCreate: prisma.platformAuditLog.create,
  };
  const state = { updateCalled: false, upsertCalled: false };
  (prisma.financialDocumentReview.findFirst as unknown) = async () => review;
  (prisma.financialDocumentReview.update as unknown) = async ({ data }: { data: Record<string, unknown> }) => {
    state.updateCalled = true;
    return { ...review, ...data };
  };
  (prisma.supplierPayment.findMany as unknown) = async () => [];
  (prisma.supplierPayment.findFirst as unknown) = async () => null;
  (prisma.supplierPayment.upsert as unknown) = async ({ create }: { create: Record<string, unknown> }) => {
    state.upsertCalled = true;
    return { id: "payment-readiness-1", ...create };
  };
  (prisma.platformAuditLog.create as unknown) = async () => ({ id: "audit-1" });
  return fn(state).finally(() => {
    (prisma.financialDocumentReview.findFirst as unknown) = original.findFirst;
    (prisma.financialDocumentReview.update as unknown) = original.update;
    (prisma.supplierPayment.findMany as unknown) = original.paymentFindMany;
    (prisma.supplierPayment.findFirst as unknown) = original.paymentFindFirst;
    (prisma.supplierPayment.upsert as unknown) = original.paymentUpsert;
    (prisma.platformAuditLog.create as unknown) = original.auditCreate;
  });
}

test("parity: readiness canApprove=true means approval succeeds on the same data", async () => {
  const review = buildReadyReview();
  await withPrismaMocks(review, async (state) => {
    const readiness = await evaluateReviewApprovalReadiness(review as never);
    assert.equal(readiness.canApprove, true, `expected ready, got block: ${readiness.blockReason}`);
    assert.equal(readiness.blockReason, null);
    assert.equal(readiness.recommendedAction, "approve");

    const approved = await approveFinancialDocumentReview(ORG, "review-ready-1");
    assert.equal(approved.review.reviewStatus, "approved");
    assert.equal(state.upsertCalled, true);
  });
});

test("parity: supplier needing confirmation blocks readiness AND approval, review stays needs_review", async () => {
  const review = buildReadyReview({
    parsedFieldsJson: {
      gates: [
        buildPassingTrustGateSnapshots().amountGate,
        { ...buildPassingTrustGateSnapshots().supplierGate, verdict: "review", reasonCode: "supplier.sir_weak_evidence" },
        buildPassingTrustGateSnapshots().fingerprintGate,
        buildPassingTrustGateSnapshots().duplicateGate,
      ],
      sir: {
        status: "resolved",
        canonicalSupplier: "Acme Ltd",
        supplierName: "Acme Ltd",
        isStrongEnoughForAutoSave: false,
      },
    },
  });
  await withPrismaMocks(review, async (state) => {
    const readiness = await evaluateReviewApprovalReadiness(review as never);
    assert.equal(readiness.canApprove, false);
    assert.equal(readiness.supplierNeedsConfirmation, true);
    assert.equal(readiness.recommendedAction, "edit_supplier");
    assert.equal(readiness.blockReason, "supplier.needs_confirmation");

    await assert.rejects(
      () => approveFinancialDocumentReview(ORG, "review-ready-1"),
      /supplier\.needs_confirmation/
    );
    assert.equal(state.updateCalled, false, "failed approval must not touch the review row");
    assert.equal(state.upsertCalled, false);
  });
});

test("parity: unresolved amount blocks readiness AND approval with the same reason", async () => {
  const review = buildReadyReview({
    totalAmount: null,
    parsedFieldsJson: {
      arc: { status: "missing", selectedAmount: null, reasonCode: "MISSING" },
      gates: [],
      sir: { status: "resolved", canonicalSupplier: "Acme Ltd", supplierName: "Acme Ltd", isStrongEnoughForAutoSave: true },
    },
  });
  await withPrismaMocks(review, async (state) => {
    const readiness = await evaluateReviewApprovalReadiness(review as never);
    assert.equal(readiness.canApprove, false);
    assert.equal(readiness.blockReason, "amount.unresolved");
    assert.equal(readiness.recommendedAction, "complete_details");

    await assert.rejects(
      () => approveFinancialDocumentReview(ORG, "review-ready-1"),
      /verified total amount/
    );
    assert.equal(state.upsertCalled, false);
  });
});

test("non-payment document type is recommended for rejection", async () => {
  const review = buildReadyReview({ documentType: "quote" });
  const readiness = await evaluateReviewApprovalReadiness(review as never);
  assert.equal(readiness.canApprove, false);
  assert.equal(readiness.recommendedAction, "reject");
  assert.equal(readiness.blockReason, "מסמך לא רלוונטי");
});

test("approval strips internal registry keys: canonicalSupplierName 'known:פז' creates payment with supplier 'פז'", async () => {
  const snapshots = buildPassingTrustGateSnapshots({
    amountGate: { normalizedAmount: 301.32 },
    supplierGate: { canonicalSupplierName: "known:פז" },
  });
  // שחזור מדויק של רשומת הפרודקשן cmr0upvdp02jbik2dtf5uq9pd
  const review = buildReadyReview({
    supplierName: "פז",
    totalAmount: 301.32,
    documentType: "receipt",
    parsedFieldsJson: {
      gates: [snapshots.amountGate, snapshots.supplierGate, snapshots.fingerprintGate, snapshots.duplicateGate],
      sir: {
        status: "resolved",
        canonicalSupplier: "known:פז",
        supplierName: "פז",
        isStrongEnoughForAutoSave: true,
      },
    },
  });
  let paymentCreate: Record<string, unknown> | null = null;
  await withPrismaMocks(review, async () => {
    const readiness = await evaluateReviewApprovalReadiness(review as never);
    assert.equal(readiness.canApprove, true, `expected ready, got: ${readiness.blockReason}`);
    const originalUpsert = prisma.supplierPayment.upsert;
    (prisma.supplierPayment.upsert as unknown) = async (args: { create: Record<string, unknown> }) => {
      paymentCreate = args.create;
      return { id: "payment-paz-1", ...args.create };
    };
    try {
      await approveFinancialDocumentReview(ORG, "review-ready-1");
    } finally {
      (prisma.supplierPayment.upsert as unknown) = originalUpsert;
    }
  });
  assert.ok(paymentCreate, "expected payment creation");
  const created = paymentCreate as Record<string, unknown>;
  assert.equal(created.supplier, "פז", `supplier must not carry internal key, got: ${created.supplier}`);
  assert.equal(created.supplierName, "פז");
});

test("supplier shown equals supplier approved: decision.displaySupplierName === payment.supplier", async () => {
  const snapshots = buildPassingTrustGateSnapshots({
    supplierGate: { canonicalSupplierName: "known:פז" },
  });
  const review = buildReadyReview({
    supplierName: "פז",
    documentType: "receipt",
    parsedFieldsJson: {
      gates: [snapshots.amountGate, snapshots.supplierGate, snapshots.fingerprintGate, snapshots.duplicateGate],
      sir: { status: "resolved", canonicalSupplier: "known:פז", supplierName: "פז", isStrongEnoughForAutoSave: true },
    },
  });
  let paymentCreate: Record<string, unknown> | null = null;
  await withPrismaMocks(review, async () => {
    const decision = await buildReviewDecision(review as never);
    assert.equal(decision.canApprove, true);
    assert.equal(decision.primaryAction, "approve");
    assert.equal(decision.displaySupplierName, "פז");

    const originalUpsert = prisma.supplierPayment.upsert;
    (prisma.supplierPayment.upsert as unknown) = async (args: { create: Record<string, unknown> }) => {
      paymentCreate = args.create;
      return { id: "payment-eq-1", ...args.create };
    };
    try {
      await approveFinancialDocumentReview(ORG, "review-ready-1");
    } finally {
      (prisma.supplierPayment.upsert as unknown) = originalUpsert;
    }
    assert.equal((paymentCreate as Record<string, unknown> | null)?.supplier, decision.displaySupplierName);
  });
});

test("approval creates a VISIBLE payment: approvalStatus approved + normalizedDocumentDate set", async () => {
  const review = buildReadyReview();
  let paymentCreate: Record<string, unknown> | null = null;
  await withPrismaMocks(review, async () => {
    const originalUpsert = prisma.supplierPayment.upsert;
    (prisma.supplierPayment.upsert as unknown) = async (args: { create: Record<string, unknown> }) => {
      paymentCreate = args.create;
      return { id: "payment-vis-1", ...args.create };
    };
    try {
      await approveFinancialDocumentReview(ORG, "review-ready-1");
    } finally {
      (prisma.supplierPayment.upsert as unknown) = originalUpsert;
    }
  });
  const created = paymentCreate as Record<string, unknown> | null;
  assert.ok(created, "expected payment creation");
  assert.equal(created?.approvalStatus, "approved");
  assert.ok(created?.normalizedDocumentDate instanceof Date, "normalizedDocumentDate must be set for month visibility");
});

test("blocked_duplicate decision surfaces the exact matched payment", async () => {
  const review = buildReadyReview();
  const existingPayment = {
    id: "payment-existing-dup",
    supplier: "Acme Ltd",
    supplierName: "Acme Ltd",
    invoiceNumber: "INV-77",
    amount: 993.33,
    totalAmount: 993.33,
    date: new Date("2026-06-15T00:00:00.000Z"),
    paid: false,
    documentTypeDetailed: "tax_invoice",
    source: "gmail",
    lastSource: "gmail",
    sourcesJson: ["gmail"],
    documentFingerprint: "doc-fp-existing",
    emailMessageId: null,
    approvalStatus: "approved",
    createdAt: new Date("2026-06-15T00:00:00.000Z"),
  };
  const original = {
    paymentFindMany: prisma.supplierPayment.findMany,
    paymentFindFirst: prisma.supplierPayment.findFirst,
  };
  (prisma.supplierPayment.findMany as unknown) = async () => [existingPayment];
  (prisma.supplierPayment.findFirst as unknown) = async () => existingPayment;
  try {
    const decision = await buildReviewDecision(review as never);
    assert.equal(decision.canApprove, false);
    assert.equal(decision.primaryAction, "blocked_duplicate");
    assert.match(String(decision.blockReason), /^duplicate\./);
    assert.ok(decision.duplicate, "expected matched duplicate details");
    assert.equal(decision.duplicate?.matchedPaymentId, "payment-existing-dup");
    assert.equal(decision.duplicate?.supplier, "Acme Ltd");
    assert.equal(decision.duplicate?.amount, 993.33);
  } finally {
    (prisma.supplierPayment.findMany as unknown) = original.paymentFindMany;
    (prisma.supplierPayment.findFirst as unknown) = original.paymentFindFirst;
  }
});

test("already-approved review reports no available action (idempotency preserved)", async () => {
  const review = buildReadyReview({ reviewStatus: "approved", supplierPaymentId: "payment-9" });
  const readiness = await evaluateReviewApprovalReadiness(review as never);
  assert.equal(readiness.canApprove, false);
  assert.equal(readiness.blockReason, null);

  await withPrismaMocks(review, async (state) => {
    const approved = await approveFinancialDocumentReview(ORG, "review-ready-1");
    assert.equal(approved.paymentId, "payment-9");
    assert.equal(state.upsertCalled, false, "idempotent approve must not recreate the payment");
  });
});
