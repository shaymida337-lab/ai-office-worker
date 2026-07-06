import test from "node:test";
import assert from "node:assert/strict";
import { ARC_VERSION } from "./amount/canonicalAmount.js";
import {
  approveFinancialDocumentReview,
  financialDocumentBlockingReason,
  financialDocumentTrustGatesBlockingReason,
  matchExistingFinancialDocumentCandidate,
} from "./financialDocuments.js";
import { TRUST_AMOUNT_GATE_MISSING } from "./trust/trustGatePersistence.js";
import { buildPassingTrustGateSnapshots } from "./trust/trustGatePersistence.js";
import { prisma } from "../lib/prisma.js";

test("financial document trust gates block empty parsed fields", () => {
  assert.equal(financialDocumentTrustGatesBlockingReason({}), TRUST_AMOUNT_GATE_MISSING);
});

test("financial document gate routes amounts at or over 1M to needs_review", () => {
  for (const totalAmount of [1_000_000, 2_000_000]) {
    const reason = financialDocumentBlockingReason({
      supplierName: "OpenAI LLC",
      invoiceNumber: "INV-2026-1001",
      totalAmount,
      documentDate: "2026-06-01",
    });

    assert.equal(reason, "amount.threshold_exceeded", `expected review for amount ${totalAmount}`);
  }
});

test("financial document gate accepts otherwise-valid amounts under 1M", () => {
  const reason = financialDocumentBlockingReason({
    supplierName: "OpenAI LLC",
    invoiceNumber: "INV-2026-1001",
    totalAmount: 500_000,
    documentDate: "2026-06-01",
  });

  assert.equal(reason, null);
});

test("financial document gate uses amount gate reason codes", () => {
  const reason = financialDocumentBlockingReason({
    supplierName: "OpenAI LLC",
    invoiceNumber: "INV-1",
    totalAmount: null,
    documentDate: "2026-06-01",
    moneyDecision: {
      selectedAmount: null,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0,
      evidenceScore: 0,
      reason: "missing",
      reasonCode: "MISSING",
      candidates: [],
      rejected: [],
      status: "missing",
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: false,
    },
  });
  assert.equal(reason, "amount.arc_missing");
});

test("financial document matcher marks known duplicate as MATCH", () => {
  const result = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI LLC",
      invoiceNumber: "INV-2026-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    candidates: [
      {
        id: "payment-1",
        supplier: "openai",
        invoiceNumber: "Invoice INV 2026-1001",
        amount: 120,
        date: new Date("2026-06-02T10:00:00.000Z"),
        documentTypeDetailed: "tax_invoice",
      },
    ],
  });

  assert.equal(result.result, "MATCH");
  assert.equal(result.candidate?.id, "payment-1");
});

test("financial document matcher lets new document proceed as NO_MATCH", () => {
  const result = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: "org-1",
      supplierName: "OpenAI",
      invoiceNumber: "INV-2026-1001",
      totalAmount: 120,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    candidates: [
      {
        id: "payment-2",
        supplier: "Netlify",
        invoiceNumber: "NF-2002",
        amount: 49,
        date: new Date("2026-06-05T10:00:00.000Z"),
        documentTypeDetailed: "invoice",
      },
    ],
  });

  assert.equal(result.result, "NO_MATCH");
  assert.equal(result.candidate, null);
});

test("financial document matcher sends borderline candidate to review as UNSURE", () => {
  const result = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: "org-1",
      supplierName: "Hardware Store Ltd",
      totalAmount: 350,
      documentDate: "2026-06-01",
      documentType: "invoice",
    },
    candidates: [
      {
        id: "payment-3",
        supplier: "hardware store",
        amount: 350,
        date: new Date("2026-06-01T12:00:00.000Z"),
        documentTypeDetailed: "invoice",
      },
    ],
  });

  assert.equal(result.result, "UNSURE");
  assert.equal(result.candidate?.id, "payment-3");
  assert.match(result.reasons.join(","), /same_supplier/);
});

test("approveFinancialDocumentReview uses VAT fallback amount for source_conflict", async () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const review = {
    id: "review-1",
    organizationId: "org-1",
    source: "gmail",
    sender: "sender@example.com",
    subject: "invoice",
    fileName: "inv.pdf",
    fileSize: 100,
    supplierName: "Acme Ltd",
    supplierTaxId: "123456789",
    invoiceNumber: "INV-1",
    documentDate: new Date("2026-07-01T00:00:00.000Z"),
    dueDate: null,
    amountBeforeVat: 849,
    vatAmount: 144.33,
    totalAmount: null,
    documentType: "tax_invoice",
    driveFileUrl: "https://drive.test/inv.pdf",
    driveUploadStatus: "uploaded",
    confidenceScore: 0.9,
    reviewStatus: "needs_review",
    uncertaintyReason: "amount.source_conflict",
    sourceFingerprint: "source-fp",
    documentFingerprint: "doc-fp",
    parsedFieldsJson: {
      arc: { status: "ambiguous", selectedAmount: null, reasonCode: "SOURCE_CONFLICT" },
      gates: [
        { ...snapshots.amountGate, verdict: "review", reasonCode: "amount.source_conflict", normalizedAmount: null },
        { ...snapshots.supplierGate, canonicalSupplierName: "Acme Ltd" },
        snapshots.fingerprintGate,
        snapshots.duplicateGate,
      ],
      sir: {
        status: "resolved",
        canonicalSupplier: "Acme Ltd",
        supplierName: "Acme Ltd",
        isStrongEnoughForAutoSave: true,
      },
    },
    rawAnalysis: null,
    emailMessageId: "email-1",
    gmailMessageId: "gmail-1",
    whatsappLogId: null,
    supplierPaymentId: null,
    currency: "ILS",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    normalizedDocumentDate: null,
  };

  const original = {
    findFirst: prisma.financialDocumentReview.findFirst,
    update: prisma.financialDocumentReview.update,
    paymentFindMany: prisma.supplierPayment.findMany,
    paymentUpsert: prisma.supplierPayment.upsert,
  };

  let capturedCreateAmount: number | null = null;
  let capturedCreateTotalAmount: number | null = null;
  let capturedNormalizedDocumentDate: Date | null = null;

  try {
    (prisma.financialDocumentReview.findFirst as any) = async () => review;
    (prisma.financialDocumentReview.update as any) = async ({ data }: any) => ({ ...review, ...data });
    (prisma.supplierPayment.findMany as any) = async () => [];
    (prisma.supplierPayment.upsert as any) = async ({ create }: any) => {
      capturedCreateAmount = create.amount;
      capturedCreateTotalAmount = create.totalAmount;
      capturedNormalizedDocumentDate = create.normalizedDocumentDate;
      return { id: "payment-1", ...create };
    };

    const approved = await approveFinancialDocumentReview("org-1", "review-1");
    assert.equal(approved.review.reviewStatus, "approved");
    assert.equal(approved.review.supplierPaymentId, "payment-1");
    assert.equal(approved.paymentId, "payment-1");
    assert.equal(approved.targetScreen, "invoices");
    assert.equal(capturedCreateAmount, 993.33);
    assert.equal(capturedCreateTotalAmount, 993.33);
    assert.ok(capturedNormalizedDocumentDate instanceof Date);
  } finally {
    (prisma.financialDocumentReview.findFirst as any) = original.findFirst;
    (prisma.financialDocumentReview.update as any) = original.update;
    (prisma.supplierPayment.findMany as any) = original.paymentFindMany;
    (prisma.supplierPayment.upsert as any) = original.paymentUpsert;
  }
});

test("approveFinancialDocumentReview is idempotent when already approved", async () => {
  const review = {
    id: "review-approved",
    organizationId: "org-1",
    reviewStatus: "approved",
    supplierPaymentId: "payment-existing",
    documentType: "receipt",
  };

  const originalFindFirst = prisma.financialDocumentReview.findFirst;
  const originalPaymentUpsert = prisma.supplierPayment.upsert;
  let upsertCalled = false;

  try {
    (prisma.financialDocumentReview.findFirst as any) = async () => review;
    (prisma.supplierPayment.upsert as any) = async () => {
      upsertCalled = true;
      return { id: "payment-dup" };
    };

    const result = await approveFinancialDocumentReview("org-1", "review-approved");
    assert.equal(result.review.reviewStatus, "approved");
    assert.equal(result.review.supplierPaymentId, "payment-existing");
    assert.equal(result.paymentId, "payment-existing");
    assert.equal(result.targetScreen, "invoices");
    assert.equal(upsertCalled, false);
  } finally {
    (prisma.financialDocumentReview.findFirst as any) = originalFindFirst;
    (prisma.supplierPayment.upsert as any) = originalPaymentUpsert;
  }
});

test("approveFinancialDocumentReview blocks cross-organization access", async () => {
  const originalFindFirst = prisma.financialDocumentReview.findFirst;
  try {
    (prisma.financialDocumentReview.findFirst as any) = async () => null;
    await assert.rejects(
      () => approveFinancialDocumentReview("org-other", "review-1"),
      /Document review item not found/,
    );
  } finally {
    (prisma.financialDocumentReview.findFirst as any) = originalFindFirst;
  }
});

test("approveFinancialDocumentReview uses confirmed supplier name for payment", async () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const review = {
    id: "review-supplier-confirm",
    organizationId: "org-1",
    source: "camera",
    sender: null,
    subject: "receipt",
    fileName: "paz.jpg",
    fileSize: 100,
    supplierName: "פרייזון",
    supplierTaxId: null,
    invoiceNumber: null,
    documentDate: new Date("2026-07-01T00:00:00.000Z"),
    dueDate: null,
    amountBeforeVat: null,
    vatAmount: null,
    totalAmount: 215.14,
    documentType: "receipt",
    driveFileUrl: "/uploads/camera-invoices/paz.jpg",
    driveUploadStatus: "uploaded",
    confidenceScore: 0.9,
    reviewStatus: "needs_review",
    uncertaintyReason: "supplier.sir_weak_evidence",
    sourceFingerprint: "source-fp-paz",
    documentFingerprint: "doc-fp-paz",
    parsedFieldsJson: {
      rawOcrText: "קבלה תחנת פז דלק",
      gates: [
        snapshots.amountGate,
        { ...snapshots.supplierGate, verdict: "review", reasonCode: "supplier.sir_weak_evidence" },
        snapshots.fingerprintGate,
        snapshots.duplicateGate,
      ],
      sir: {
        status: "resolved",
        canonicalSupplier: "פרייזון",
        supplierName: "פרייזון",
        isStrongEnoughForAutoSave: false,
      },
    },
    rawAnalysis: null,
    emailMessageId: null,
    gmailMessageId: null,
    whatsappLogId: null,
    supplierPaymentId: null,
    currency: "ILS",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    normalizedDocumentDate: null,
  };

  const original = {
    findFirst: prisma.financialDocumentReview.findFirst,
    update: prisma.financialDocumentReview.update,
    paymentFindMany: prisma.supplierPayment.findMany,
    paymentUpsert: prisma.supplierPayment.upsert,
  };

  let capturedSupplier: string | null = null;

  try {
    (prisma.financialDocumentReview.findFirst as any) = async () => review;
    (prisma.financialDocumentReview.update as any) = async ({ data }: any) => ({ ...review, ...data });
    (prisma.supplierPayment.findMany as any) = async () => [];
    (prisma.supplierPayment.upsert as any) = async ({ create }: any) => {
      capturedSupplier = create.supplier;
      return { id: "payment-paz", ...create };
    };

    const result = await approveFinancialDocumentReview("org-1", "review-supplier-confirm", {
      confirmedSupplierName: "פז",
    });
    assert.equal(capturedSupplier, "פז");
    assert.equal(result.paymentId, "payment-paz");
    assert.equal(result.targetScreen, "invoices");
  } finally {
    (prisma.financialDocumentReview.findFirst as any) = original.findFirst;
    (prisma.financialDocumentReview.update as any) = original.update;
    (prisma.supplierPayment.findMany as any) = original.paymentFindMany;
    (prisma.supplierPayment.upsert as any) = original.paymentUpsert;
  }
});

test("approveFinancialDocumentReview blocks arc_missing with no fallback amount", async () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const review = {
    id: "review-2",
    organizationId: "org-1",
    source: "gmail",
    sender: "sender@example.com",
    subject: "invoice",
    fileName: "inv.pdf",
    fileSize: 100,
    supplierName: "Acme Ltd",
    supplierTaxId: "123456789",
    invoiceNumber: "INV-2",
    documentDate: new Date("2026-07-01T00:00:00.000Z"),
    dueDate: null,
    amountBeforeVat: null,
    vatAmount: null,
    totalAmount: null,
    documentType: "tax_invoice",
    driveFileUrl: "https://drive.test/inv.pdf",
    driveUploadStatus: "uploaded",
    confidenceScore: 0.9,
    reviewStatus: "needs_review",
    uncertaintyReason: "amount.arc_missing",
    sourceFingerprint: "source-fp",
    documentFingerprint: "doc-fp-2",
    parsedFieldsJson: {
      arc: { status: "missing", selectedAmount: null, reasonCode: "MISSING" },
      gates: [
        { ...snapshots.amountGate, verdict: "review", reasonCode: "amount.arc_missing", normalizedAmount: null },
        snapshots.supplierGate,
        snapshots.fingerprintGate,
        snapshots.duplicateGate,
      ],
      sir: {
        status: "resolved",
        canonicalSupplier: "Acme Ltd",
        supplierName: "Acme Ltd",
        isStrongEnoughForAutoSave: true,
      },
    },
    rawAnalysis: null,
    emailMessageId: "email-2",
    gmailMessageId: "gmail-2",
    whatsappLogId: null,
    supplierPaymentId: null,
    currency: "ILS",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    normalizedDocumentDate: null,
  };

  const originalFindFirst = prisma.financialDocumentReview.findFirst;
  const originalPaymentUpsert = prisma.supplierPayment.upsert;
  let upsertCalled = false;
  try {
    (prisma.financialDocumentReview.findFirst as any) = async () => review;
    (prisma.supplierPayment.upsert as any) = async () => {
      upsertCalled = true;
      return { id: "payment-2" };
    };
    await assert.rejects(
      () => approveFinancialDocumentReview("org-1", "review-2"),
      /Cannot approve document without a verified total amount/
    );
    assert.equal(upsertCalled, false);
  } finally {
    (prisma.financialDocumentReview.findFirst as any) = originalFindFirst;
    (prisma.supplierPayment.upsert as any) = originalPaymentUpsert;
  }
});

test("approveFinancialDocumentReview failure does not mark review approved", async () => {
  const snapshots = buildPassingTrustGateSnapshots();
  const review = {
    id: "review-fail",
    organizationId: "org-1",
    source: "camera",
    sender: null,
    subject: "receipt",
    fileName: "paz.jpg",
    fileSize: 100,
    supplierName: "פז",
    supplierTaxId: null,
    invoiceNumber: null,
    documentDate: new Date("2026-07-01T00:00:00.000Z"),
    dueDate: null,
    amountBeforeVat: null,
    vatAmount: null,
    totalAmount: 215.14,
    documentType: "receipt",
    driveFileUrl: "/uploads/camera-invoices/paz.jpg",
    driveUploadStatus: "uploaded",
    confidenceScore: 0.9,
    reviewStatus: "needs_review",
    uncertaintyReason: null,
    sourceFingerprint: "source-fp-fail",
    documentFingerprint: "doc-fp-fail",
    parsedFieldsJson: {
      gates: [snapshots.amountGate, snapshots.supplierGate, snapshots.fingerprintGate, snapshots.duplicateGate],
      sir: {
        status: "resolved",
        canonicalSupplier: "פז",
        supplierName: "פז",
        isStrongEnoughForAutoSave: true,
      },
    },
    rawAnalysis: null,
    emailMessageId: null,
    gmailMessageId: null,
    whatsappLogId: null,
    supplierPaymentId: null,
    currency: "ILS",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    normalizedDocumentDate: null,
  };

  const original = {
    findFirst: prisma.financialDocumentReview.findFirst,
    update: prisma.financialDocumentReview.update,
    paymentFindMany: prisma.supplierPayment.findMany,
    paymentUpsert: prisma.supplierPayment.upsert,
  };

  let approvedUpdate = false;

  try {
    (prisma.financialDocumentReview.findFirst as any) = async () => review;
    (prisma.financialDocumentReview.update as any) = async ({ data }: any) => {
      if (data.reviewStatus === "approved") approvedUpdate = true;
      return { ...review, ...data };
    };
    (prisma.supplierPayment.findMany as any) = async () => [];
    (prisma.supplierPayment.upsert as any) = async () => {
      throw new Error("db write failed");
    };

    await assert.rejects(
      () => approveFinancialDocumentReview("org-1", "review-fail", { confirmedSupplierName: "פז" }),
      /db write failed/,
    );
    assert.equal(approvedUpdate, false);
  } finally {
    (prisma.financialDocumentReview.findFirst as any) = original.findFirst;
    (prisma.financialDocumentReview.update as any) = original.update;
    (prisma.supplierPayment.findMany as any) = original.paymentFindMany;
    (prisma.supplierPayment.upsert as any) = original.paymentUpsert;
  }
});
