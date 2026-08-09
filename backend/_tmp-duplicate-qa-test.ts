import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import {
  approveFinancialDocumentReview,
  buildDuplicateGateInput,
  buildManualEntryParsedFields,
  buildReviewDecision,
  recordFinancialDocumentDecision,
} from "./src/services/financialDocuments.js";

const prisma = new PrismaClient();
const QA_TAG = "QA_SYNTHETIC_DO_NOT_PAY";

type InvoiceSeed = {
  label: "A" | "B" | "C";
  supplierName: string;
  invoiceNumber: string;
  totalAmount: number;
  documentDate: Date;
  supplierTaxId: string;
  fileName: string;
  subject: string;
  fileShaSeed: string;
};

async function main() {
  const startedAt = new Date();
  const runId = `dup-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const evidenceLogs: string[] = [];
  const captureLog = (...parts: Array<string | number | boolean | null | undefined>) => {
    const line = parts.map((p) => String(p ?? "")).join(" ");
    evidenceLogs.push(line);
    console.log(line);
  };

  let organizationId: string | null = null;
  let userId: string | null = null;
  const report: Record<string, unknown> = {
    runId,
    tag: QA_TAG,
    startedAt: startedAt.toISOString(),
    scenario: "Focused duplicate QA (A approve, B duplicate, C non-duplicate)",
  };

  try {
    const user = await prisma.user.create({
      data: {
        email: `qa.synthetic.dup.${runId}@example.test`,
        name: `${QA_TAG} ${runId}`,
      },
      select: { id: true },
    });
    userId = user.id;
    const organization = await prisma.organization.create({
      data: {
        userId: user.id,
        name: `${QA_TAG}_${runId}`,
        businessName: `${QA_TAG}_${runId}`,
      },
      select: { id: true, name: true },
    });
    organizationId = organization.id;
    captureLog("[qa] created isolated org", organization.id, organization.name);

    const baseInvoiceA: InvoiceSeed = {
      label: "A",
      supplierName: "ספק בדיקה סינתטי",
      supplierTaxId: "515555555",
      invoiceNumber: "QA-INV-1001",
      totalAmount: 3210.45,
      documentDate: new Date("2026-07-08T09:00:00.000Z"),
      fileName: `${QA_TAG}_invoice_A.pdf`,
      subject: `${QA_TAG} invoice A`,
      fileShaSeed: `${QA_TAG}|A|exact-content`,
    };
    const invoiceB: InvoiceSeed = {
      ...baseInvoiceA,
      label: "B",
      fileName: `${QA_TAG}_invoice_B_DUPLICATE.pdf`,
      subject: `${QA_TAG} invoice B duplicate`,
    };
    const invoiceC: InvoiceSeed = {
      ...baseInvoiceA,
      label: "C",
      invoiceNumber: "QA-INV-1002",
      totalAmount: 3399.11,
      fileName: `${QA_TAG}_invoice_C_NEW.pdf`,
      subject: `${QA_TAG} invoice C same supplier different invoice number`,
      fileShaSeed: `${QA_TAG}|C|new-content`,
    };

    // Invoice A: enters review queue first, then manual approval path.
    const parsedA = await buildManualEntryParsedFields({
      organizationId,
      source: "camera",
      supplierName: baseInvoiceA.supplierName,
      supplierTaxId: baseInvoiceA.supplierTaxId,
      invoiceNumber: baseInvoiceA.invoiceNumber,
      totalAmount: baseInvoiceA.totalAmount,
      documentDate: baseInvoiceA.documentDate,
      documentType: "tax_invoice",
      subject: baseInvoiceA.subject,
      fileSha256: sha(baseInvoiceA.fileShaSeed),
    });
    const decisionA = await recordFinancialDocumentDecision({
      organizationId,
      source: "camera",
      sender: null,
      subject: baseInvoiceA.subject,
      fileName: baseInvoiceA.fileName,
      fileSize: 10240,
      supplierName: baseInvoiceA.supplierName,
      supplierTaxId: baseInvoiceA.supplierTaxId,
      invoiceNumber: baseInvoiceA.invoiceNumber,
      documentDate: baseInvoiceA.documentDate,
      totalAmount: baseInvoiceA.totalAmount,
      documentType: "tax_invoice",
      confidenceScore: 0.99,
      parsedFieldsJson: parsedA.parsedFieldsJson,
      fileSha256: sha(baseInvoiceA.fileShaSeed),
      forceNeedsReview: true,
      uncertaintyReason: `${QA_TAG}: force review for QA approval flow`,
    });
    if (decisionA.action !== "needs_review" || !decisionA.review) {
      throw new Error(`Invoice A did not reach review as expected. action=${decisionA.action}`);
    }

    const reviewAId = decisionA.review.id;
    const preDecisionA = await buildReviewDecision({
      ...(await prisma.financialDocumentReview.findFirstOrThrow({
        where: { id: reviewAId, organizationId },
      })),
      organizationId,
    });

    const approvedA = await approveFinancialDocumentReview(organizationId, reviewAId, {
      sourceRoute: "QA_TMP_SCRIPT",
    });
    const paymentA = await prisma.supplierPayment.findFirst({
      where: { id: approvedA.paymentId, organizationId },
      select: {
        id: true,
        supplier: true,
        invoiceNumber: true,
        amount: true,
        totalAmount: true,
        approvalStatus: true,
        documentFingerprint: true,
        sourceFingerprint: true,
      },
    });
    if (!paymentA) throw new Error("Invoice A approval did not create/find supplier payment");

    // Invoice B: exact duplicate of A; expect duplicate action and no second payment.
    const parsedB = await buildManualEntryParsedFields({
      organizationId,
      source: "camera",
      supplierName: invoiceB.supplierName,
      supplierTaxId: invoiceB.supplierTaxId,
      invoiceNumber: invoiceB.invoiceNumber,
      totalAmount: invoiceB.totalAmount,
      documentDate: invoiceB.documentDate,
      documentType: "tax_invoice",
      subject: invoiceB.subject,
      fileSha256: sha(invoiceB.fileShaSeed),
    });
    const duplicateProbeB = await buildDuplicateGateInput({
      organizationId,
      source: "camera",
      sender: null,
      supplierName: invoiceB.supplierName,
      supplierTaxId: invoiceB.supplierTaxId,
      invoiceNumber: invoiceB.invoiceNumber,
      totalAmount: invoiceB.totalAmount,
      documentDate: invoiceB.documentDate,
      documentType: "tax_invoice",
      fileSha256: sha(invoiceB.fileShaSeed),
      documentFingerprint: parsedB.documentFingerprint,
      legacyDuplicateHash: parsedB.documentFingerprint,
      scfcFingerprint: parsedB.documentFingerprint,
      parsedFieldsJson: parsedB.parsedFieldsJson,
    });
    const decisionB = await recordFinancialDocumentDecision({
      organizationId,
      source: "camera",
      sender: null,
      subject: invoiceB.subject,
      fileName: invoiceB.fileName,
      fileSize: 10240,
      supplierName: invoiceB.supplierName,
      supplierTaxId: invoiceB.supplierTaxId,
      invoiceNumber: invoiceB.invoiceNumber,
      documentDate: invoiceB.documentDate,
      totalAmount: invoiceB.totalAmount,
      documentType: "tax_invoice",
      confidenceScore: 0.99,
      parsedFieldsJson: parsedB.parsedFieldsJson,
      fileSha256: sha(invoiceB.fileShaSeed),
    });
    const paymentCountAfterB = await prisma.supplierPayment.count({ where: { organizationId } });
    const duplicateReviewB = await prisma.financialDocumentReview.findFirst({
      where: {
        organizationId,
        invoiceNumber: invoiceB.invoiceNumber,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        reviewStatus: true,
        uncertaintyReason: true,
        supplierPaymentId: true,
      },
    });
    const duplicateDecisionB = duplicateReviewB
      ? await buildReviewDecision({
          ...(await prisma.financialDocumentReview.findFirstOrThrow({
            where: { id: duplicateReviewB.id, organizationId },
          })),
          organizationId,
        })
      : null;
    const duplicateActionSucceeded = decisionB.action === "duplicate" && Boolean(decisionB.payment);
    const duplicateHardBlockedInReview =
      decisionB.action === "needs_review" &&
      duplicateDecisionB?.primaryAction === "blocked_duplicate" &&
      Boolean(duplicateDecisionB.blockReason?.startsWith("duplicate."));
    if (!duplicateActionSucceeded && !duplicateHardBlockedInReview) {
      throw new Error(`Invoice B did not trigger hard duplicate handling. action=${decisionB.action}`);
    }

    // Invoice C: same supplier, different invoice number; expect accepted/not duplicate.
    const parsedC = await buildManualEntryParsedFields({
      organizationId,
      source: "camera",
      supplierName: invoiceC.supplierName,
      supplierTaxId: invoiceC.supplierTaxId,
      invoiceNumber: invoiceC.invoiceNumber,
      totalAmount: invoiceC.totalAmount,
      documentDate: invoiceC.documentDate,
      documentType: "tax_invoice",
      subject: invoiceC.subject,
      fileSha256: sha(invoiceC.fileShaSeed),
    });
    const decisionC = await recordFinancialDocumentDecision({
      organizationId,
      source: "camera",
      sender: null,
      subject: invoiceC.subject,
      fileName: invoiceC.fileName,
      fileSize: 10240,
      supplierName: invoiceC.supplierName,
      supplierTaxId: invoiceC.supplierTaxId,
      invoiceNumber: invoiceC.invoiceNumber,
      documentDate: invoiceC.documentDate,
      totalAmount: invoiceC.totalAmount,
      documentType: "tax_invoice",
      confidenceScore: 0.99,
      parsedFieldsJson: parsedC.parsedFieldsJson,
      fileSha256: sha(invoiceC.fileShaSeed),
    });

    if (decisionC.action !== "accepted") {
      throw new Error(`Invoice C was expected accepted but got ${decisionC.action}`);
    }
    const reviewC = await prisma.financialDocumentReview.findFirst({
      where: {
        organizationId,
        invoiceNumber: invoiceC.invoiceNumber,
      },
      select: {
        id: true,
        reviewStatus: true,
        uncertaintyReason: true,
      },
    });

    report["results"] = {
      organizationId,
      invoiceA: {
        action: decisionA.action,
        reviewId: reviewAId,
        preApprovalDecision: preDecisionA,
        approvedReviewStatus: approvedA.review.reviewStatus,
        paymentId: approvedA.paymentId,
        payment: paymentA,
      },
      invoiceB: {
        action: decisionB.action,
        duplicateProbe: {
          matchResult: duplicateProbeB.matchResult,
          matchReasons: duplicateProbeB.matchReasons,
          matchedCandidateId: duplicateProbeB.matchedCandidate?.id ?? null,
        },
        duplicateDecision: duplicateDecisionB,
        duplicatePaymentId: decisionB.payment?.id ?? null,
        duplicateMatchedPaymentEqualsA: decisionB.payment?.id === paymentA.id,
        paymentCountAfterB,
        reviewRecord: duplicateReviewB,
        userFacingDuplicateMessageSignal:
          duplicateReviewB?.reviewStatus === "duplicate"
            ? "duplicate review status is set (UI should render duplicate warning)"
            : "missing duplicate review status",
      },
      invoiceC: {
        action: decisionC.action,
        reviewRecord: reviewC,
      },
      assertions: {
        invoiceNumberPersistedOnApprovedPayment: Boolean(paymentA.invoiceNumber?.trim()),
        noSecondPaymentOnDuplicate: paymentCountAfterB === 1,
        duplicateReasonRecorded: Boolean(duplicateReviewB?.uncertaintyReason?.startsWith("duplicate.")),
        duplicateRoutedToExistingPayment:
          decisionB.payment?.id === paymentA.id ||
          duplicateDecisionB?.duplicate?.matchedPaymentId === paymentA.id,
        duplicateActionSucceeded,
        duplicateHardBlockedInReview,
        sameSupplierDifferentInvoiceAccepted: decisionC.action === "accepted",
      },
    };

    if (!paymentA.invoiceNumber?.trim()) {
      throw new Error("Invoice A approved payment missing invoiceNumber");
    }

    const auditRows = await prisma.platformAuditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        reason: true,
        sourceModule: true,
        createdAt: true,
      },
      take: 50,
    });
    report["auditEvidence"] = auditRows;
    report["evidenceLogs"] = evidenceLogs;
    report["completedAt"] = new Date().toISOString();
  } catch (error) {
    report["error"] = error instanceof Error ? error.message : String(error);
    report["failedAt"] = new Date().toISOString();
    throw error;
  } finally {
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } }).catch(async () => {
        await prisma.organization.deleteMany({ where: { id: organizationId! } });
      });
      report["cleanup"] = { organizationDeleted: true, organizationId };
      captureLog("[qa] cleanup complete", organizationId);
    } else {
      report["cleanup"] = { organizationDeleted: false };
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
    // Write after cleanup so report always includes cleanup state.
    const fs = await import("fs/promises");
    await fs.writeFile(
      new URL("./_tmp-duplicate-qa-report.json", import.meta.url),
      JSON.stringify(report, null, 2),
      "utf8"
    );
  }
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

main().catch((err) => {
  console.error("[qa] duplicate validation failed", err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
