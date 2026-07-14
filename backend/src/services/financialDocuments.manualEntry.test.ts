import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualEntryParsedFields,
  MANUAL_ENTRY_CONFIDENCE,
  recordManualEntryFinancialDocument,
} from "./financialDocuments.js";
import {
  parseTrustGatesFromParsedFields,
  trustGatesFailClosedReason,
} from "./trust/trustGatePersistence.js";
import { prisma } from "../lib/prisma.js";

const ORG = "org-manual-entry";

const completeInvoice = {
  organizationId: ORG,
  source: "camera" as const,
  // Required while FINANCIAL_INGESTION_CONTAINMENT is active — same scope confirmCameraDocument builds.
  verifiedTenantScope: {
    tenantScopeVerified: true as const,
    organizationId: ORG,
    source: "camera" as const,
    reviewId: "review-manual-1",
  },
  supplierName: "אלקטרה מיזוג אוויר בע\"מ",
  supplierTaxId: null,
  invoiceNumber: "INV-2026-042",
  totalAmount: 1170,
  documentDate: new Date("2026-07-01T00:00:00.000Z"),
  documentType: "tax_invoice",
  fileSha256: "a".repeat(64),
  subject: "Camera invoice scan #INV-2026-042",
};

function withPrismaMocks<T>(
  overrides: {
    paymentFindMany?: unknown[];
    onReviewUpsert?: (args: { create: Record<string, unknown> }) => void;
    onPaymentUpsert?: (args: { create: Record<string, unknown> }) => void;
  },
  fn: () => Promise<T>
): Promise<T> {
  const original = {
    paymentFindMany: prisma.supplierPayment.findMany,
    paymentFindFirst: prisma.supplierPayment.findFirst,
    paymentUpsert: prisma.supplierPayment.upsert,
    reviewUpsert: prisma.financialDocumentReview.upsert,
    auditCreate: prisma.platformAuditLog.create,
  };
  (prisma.platformAuditLog.create as unknown) = async () => ({ id: "audit-1" });
  (prisma.supplierPayment.findMany as unknown) = async () => overrides.paymentFindMany ?? [];
  (prisma.supplierPayment.findFirst as unknown) = async () => null;
  (prisma.supplierPayment.upsert as unknown) = async (args: { create: Record<string, unknown> }) => {
    overrides.onPaymentUpsert?.(args);
    return { id: "payment-manual-1", ...args.create };
  };
  (prisma.financialDocumentReview.upsert as unknown) = async (args: { create: Record<string, unknown> }) => {
    overrides.onReviewUpsert?.(args);
    return { id: "review-manual-1", ...args.create };
  };
  return fn().finally(() => {
    (prisma.supplierPayment.findMany as unknown) = original.paymentFindMany;
    (prisma.supplierPayment.findFirst as unknown) = original.paymentFindFirst;
    (prisma.supplierPayment.upsert as unknown) = original.paymentUpsert;
    (prisma.financialDocumentReview.upsert as unknown) = original.reviewUpsert;
    (prisma.platformAuditLog.create as unknown) = original.auditCreate;
  });
}

test("manual entry builds real passing trust gates for a complete invoice (no trust.gates_missing)", async () => {
  await withPrismaMocks({}, async () => {
    const { parsedFieldsJson } = await buildManualEntryParsedFields(completeInvoice);
    const gates = parseTrustGatesFromParsedFields(parsedFieldsJson);
    assert.ok(gates.amountGate, "amount gate missing");
    assert.ok(gates.supplierGate, "supplier gate missing");
    assert.ok(gates.fingerprintGate, "fingerprint gate missing");
    assert.ok(gates.duplicateGate, "duplicate gate missing");
    assert.equal(trustGatesFailClosedReason(gates), null);
  });
});

test("manual entry with junk supplier name fails the supplier gate with a specific reason", async () => {
  await withPrismaMocks({}, async () => {
    const { parsedFieldsJson } = await buildManualEntryParsedFields({
      ...completeInvoice,
      supplierName: "לא זוהה",
    });
    const reason = trustGatesFailClosedReason(parseTrustGatesFromParsedFields(parsedFieldsJson));
    assert.equal(reason, "supplier.placeholder_hebrew");
    assert.notEqual(reason, "trust.gates_missing");
  });
});

test("complete camera invoice is accepted and creates an approved payment (not forced to review)", async () => {
  let paymentCreate: Record<string, unknown> | null = null;
  let reviewCreated = false;
  await withPrismaMocks(
    {
      onPaymentUpsert: (args) => {
        paymentCreate = args.create;
      },
      onReviewUpsert: () => {
        reviewCreated = true;
      },
    },
    async () => {
      const decision = await recordManualEntryFinancialDocument({
        ...completeInvoice,
        fileName: "invoice.jpg",
        fileSize: 2048,
        userId: "user-1",
        sourceRoute: "POST /camera/invoices",
      });
      assert.equal(decision.action, "accepted");
      assert.ok("payment" in decision && decision.payment, "expected payment to be created");
      assert.ok(paymentCreate, "expected supplierPayment.upsert create payload");
      const created = paymentCreate as Record<string, unknown>;
      assert.equal(created.approvalStatus, "approved");
      assert.equal(created.confidenceScore, MANUAL_ENTRY_CONFIDENCE);
      assert.equal(reviewCreated, false, "accepted path must not create a pending review");
    }
  );
});

test("camera confirm without invoice number still creates approved payment (OCR often misses #)", async () => {
  let paymentCreate: Record<string, unknown> | null = null;
  await withPrismaMocks(
    {
      onPaymentUpsert: (args) => {
        paymentCreate = args.create;
      },
    },
    async () => {
      const decision = await recordManualEntryFinancialDocument({
        ...completeInvoice,
        invoiceNumber: null,
        fileName: "invoice.jpg",
        fileSize: 2048,
        userId: "user-1",
        sourceRoute: "POST /camera/invoices (confirm)",
      });
      assert.equal(decision.action, "accepted");
      assert.ok("payment" in decision && decision.payment, "expected payment to be created");
      assert.ok(paymentCreate, "expected supplierPayment.upsert");
      assert.equal((paymentCreate as Record<string, unknown>).approvalStatus, "approved");
    }
  );
});

test("gmail path still blocks when invoice number is missing", async () => {
  const reason = (
    await import("./financialDocuments.js")
  ).financialDocumentBlockingReason({
    supplierName: completeInvoice.supplierName,
    invoiceNumber: null,
    totalAmount: completeInvoice.totalAmount,
    documentDate: completeInvoice.documentDate,
    requireInvoiceNumber: true,
  });
  assert.equal(reason, "invoice number missing");
});

test("duplicate-risk camera invoice still goes to review with a duplicate reason", async () => {
  let reviewCreate: Record<string, unknown> | null = null;
  await withPrismaMocks(
    {
      // מועמד זהה בתשלומים קיימים — שער הכפילויות חייב לתפוס אותו
      paymentFindMany: [
        {
          id: "payment-existing",
          supplier: completeInvoice.supplierName,
          supplierName: completeInvoice.supplierName,
          invoiceNumber: completeInvoice.invoiceNumber,
          amount: completeInvoice.totalAmount,
          totalAmount: completeInvoice.totalAmount,
          date: completeInvoice.documentDate,
          documentTypeDetailed: "tax_invoice",
          source: "gmail",
          lastSource: "gmail",
          sourcesJson: ["gmail"],
          documentFingerprint: "existing-fp",
          emailMessageId: null,
          approvalStatus: "approved",
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      ],
      onReviewUpsert: (args) => {
        reviewCreate = args.create;
      },
    },
    async () => {
      const decision = await recordManualEntryFinancialDocument({
        ...completeInvoice,
        fileName: "invoice.jpg",
        fileSize: 2048,
      });
      assert.equal(decision.action, "needs_review");
      assert.ok(reviewCreate, "expected review record");
      const reason = String((reviewCreate as Record<string, unknown>).uncertaintyReason ?? "");
      assert.ok(
        reason.startsWith("duplicate.") || reason.includes("duplicate"),
        `expected duplicate reason, got: ${reason}`
      );
    }
  );
});
