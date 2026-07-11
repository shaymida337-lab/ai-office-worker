import type { FinancialDocumentReview, GmailScanItem, Prisma, SupplierPayment } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { approveFinancialDocumentReview } from "./financialDocuments.js";
import {
  assessInvoiceCompleteness,
  type InvoiceCompletenessAssessment,
} from "./amount/invoiceCompleteness.js";
import {
  isQuarantinedFinancialDocumentReview,
  isQuarantinedGmailScanItem,
  isQuarantinedSupplierPayment,
} from "./p0/crossOrgGmailQuarantine.js";
import {
  crossOrgGmailIdsExcludedForOrganization,
  loadCrossOrgContaminatedGmailIdsForReads,
} from "./p0/financialReadIsolation.js";

export type InvoiceCompletionSourceType = "gmail-scan-item" | "document-review" | "supplier-payment";

export type InvoiceCompletionRequest = {
  supplier?: string;
  amount?: number;
  date?: string;
  documentType?: string;
  currency?: string;
  approve?: boolean;
};

export type InvoiceCompletionContext = {
  sourceType: InvoiceCompletionSourceType;
  gsi: GmailScanItem | null;
  review: FinancialDocumentReview | null;
  payment: SupplierPayment | null;
};

export type InvoiceCompletionResult = {
  context: InvoiceCompletionContext;
  assessment: InvoiceCompletenessAssessment;
  approved: boolean;
  destination: "invoices" | "completion";
};

export function parseInvoiceCompletionSourceType(value: string): InvoiceCompletionSourceType | null {
  if (value === "gmail-scan-item" || value === "gmail_scan_item") return "gmail-scan-item";
  if (value === "document-review" || value === "financial_document_review") return "document-review";
  if (value === "supplier-payment" || value === "supplier_payment") return "supplier-payment";
  return null;
}

export function stripInvoiceCompletionId(id: string): string {
  return id
    .replace(/^gmail-scan:/, "")
    .replace(/^document-review:/, "")
    .replace(/^supplier-payment:/, "");
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function assertReadableGmailMessageId(organizationId: string, gmailMessageId: string | null | undefined) {
  if (!gmailMessageId) return;
  const contaminated = await loadCrossOrgContaminatedGmailIdsForReads();
  const excluded = crossOrgGmailIdsExcludedForOrganization(organizationId, contaminated);
  if (excluded.includes(gmailMessageId)) {
    throw new Error("המסמך חסום לצפייה בגלל סימון contamination");
  }
}

async function findLinkedReviewForGmailScanItem(organizationId: string, item: GmailScanItem) {
  const orClauses: Prisma.FinancialDocumentReviewWhereInput[] = [];
  if (item.gmailMessageId) orClauses.push({ gmailMessageId: item.gmailMessageId });
  if (item.emailMessageId) orClauses.push({ emailMessageId: item.emailMessageId });
  if (item.duplicateKey) orClauses.push({ documentFingerprint: item.duplicateKey });
  if (orClauses.length === 0) return null;

  return prisma.financialDocumentReview.findFirst({
    where: {
      organizationId,
      OR: orClauses,
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function loadInvoiceCompletionContext(
  organizationId: string,
  sourceType: InvoiceCompletionSourceType,
  rawId: string,
): Promise<InvoiceCompletionContext> {
  const id = stripInvoiceCompletionId(rawId);

  if (sourceType === "gmail-scan-item") {
    const gsi = await prisma.gmailScanItem.findFirst({ where: { id, organizationId } });
    if (!gsi) throw new Error("Gmail scan item not found");
    if (isQuarantinedGmailScanItem(gsi)) throw new Error("המסמך חסום לעריכה בגלל contamination");
    await assertReadableGmailMessageId(organizationId, gsi.gmailMessageId);
    const review = await findLinkedReviewForGmailScanItem(organizationId, gsi);
    if (review && isQuarantinedFinancialDocumentReview(review)) {
      throw new Error("המסמך חסום לעריכה בגלל contamination");
    }
    return { sourceType, gsi, review, payment: null };
  }

  if (sourceType === "document-review") {
    const review = await prisma.financialDocumentReview.findFirst({ where: { id, organizationId } });
    if (!review) throw new Error("Document review item not found");
    if (isQuarantinedFinancialDocumentReview(review)) throw new Error("המסמך חסום לעריכה בגלל contamination");
    await assertReadableGmailMessageId(organizationId, review.gmailMessageId);
    const gsi = review.gmailMessageId
      ? await prisma.gmailScanItem.findFirst({ where: { organizationId, gmailMessageId: review.gmailMessageId } })
      : null;
    const payment = review.supplierPaymentId
      ? await prisma.supplierPayment.findFirst({ where: { id: review.supplierPaymentId, organizationId } })
      : null;
    return { sourceType, gsi, review, payment };
  }

  const payment = await prisma.supplierPayment.findFirst({ where: { id, organizationId } });
  if (!payment) throw new Error("Supplier payment not found");
  if (isQuarantinedSupplierPayment(payment)) throw new Error("המסמך חסום לעריכה בגלל contamination");
  const review = await prisma.financialDocumentReview.findFirst({
    where: { organizationId, supplierPaymentId: payment.id },
    orderBy: { updatedAt: "desc" },
  });
  if (review && isQuarantinedFinancialDocumentReview(review)) {
    throw new Error("המסמך חסום לעריכה בגלל contamination");
  }
  const gsi = payment.emailMessageId
    ? await prisma.gmailScanItem.findFirst({ where: { organizationId, emailMessageId: payment.emailMessageId } })
    : null;
  return { sourceType, gsi, review, payment };
}

export async function applyInvoiceCompletionFieldUpdates(
  ctx: InvoiceCompletionContext,
  input: InvoiceCompletionRequest,
): Promise<InvoiceCompletionContext> {
  const parsedDate = parseOptionalDate(input.date);
  const supplier = input.supplier?.trim() || null;
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0 ? input.amount : null;
  const currency = input.currency?.trim() || null;
  const documentType = input.documentType?.trim() || null;

  let { gsi, review, payment } = ctx;

  if (review) {
    review = await prisma.financialDocumentReview.update({
      where: { id: review.id },
      data: {
        ...(supplier ? { supplierName: supplier } : {}),
        ...(amount != null ? { totalAmount: amount } : {}),
        ...(parsedDate ? { documentDate: parsedDate, normalizedDocumentDate: parsedDate } : {}),
        ...(currency ? { currency } : {}),
        ...(documentType ? { documentType } : {}),
      },
    });
  }

  if (gsi) {
    const raw = (gsi.rawAnalysis && typeof gsi.rawAnalysis === "object" && !Array.isArray(gsi.rawAnalysis))
      ? { ...(gsi.rawAnalysis as Record<string, unknown>) }
      : {};
    const analysis = (raw.analysis && typeof raw.analysis === "object" && !Array.isArray(raw.analysis))
      ? { ...(raw.analysis as Record<string, unknown>) }
      : {};
    if (supplier) analysis.supplierName = supplier;
    if (amount != null) analysis.totalAmount = amount;
    if (parsedDate) analysis.invoiceDate = parsedDate.toISOString();
    if (currency) analysis.currency = currency;
    raw.analysis = analysis;
    gsi = await prisma.gmailScanItem.update({
      where: { id: gsi.id },
      data: {
        ...(supplier ? { supplierName: supplier } : {}),
        ...(amount != null ? { amount } : {}),
        ...(documentType ? { documentType } : {}),
        rawAnalysis: raw as import("@prisma/client").Prisma.InputJsonValue,
      },
    });
  }

  if (payment) {
    payment = await prisma.supplierPayment.update({
      where: { id: payment.id },
      data: {
        ...(supplier ? { supplierName: supplier, supplier } : {}),
        ...(amount != null ? { amount, totalAmount: amount } : {}),
        ...(parsedDate ? { date: parsedDate, normalizedDocumentDate: parsedDate } : {}),
        ...(currency ? { currency } : {}),
        ...(documentType ? { documentTypeDetailed: documentType } : {}),
      },
    });
  }

  return { ...ctx, gsi, review, payment };
}

export function validateApproveAllowed(assessment: InvoiceCompletenessAssessment) {
  if (!assessment.dataComplete) {
    const firstMissing = assessment.missingDataReasons[0] ?? "חסרים שדות חובה";
    throw new Error(`לא ניתן לאשר — ${firstMissing}`);
  }
}

export async function approveInvoiceCompletionContext(
  organizationId: string,
  ctx: InvoiceCompletionContext,
  options: { userId?: string; sourceRoute: string; supplier?: string },
): Promise<InvoiceCompletionContext> {
  let { gsi, review, payment } = ctx;

  if (review) {
    const result = await approveFinancialDocumentReview(organizationId, review.id, {
      userId: options.userId,
      sourceRoute: options.sourceRoute,
      confirmedSupplierName: options.supplier,
    });
    review = result.review;
    if (gsi) {
      gsi = await prisma.gmailScanItem.update({
        where: { id: gsi.id },
        data: { reviewStatus: "approved" },
      });
    }
    return { ...ctx, gsi, review, payment };
  }

  if (gsi) {
    gsi = await prisma.gmailScanItem.update({
      where: { id: gsi.id },
      data: { reviewStatus: "approved" },
    });
    return { ...ctx, gsi, review, payment };
  }

  if (payment) {
    payment = await prisma.supplierPayment.update({
      where: { id: payment.id },
      data: { approvalStatus: "approved" },
    });
    return { ...ctx, gsi, review, payment };
  }

  throw new Error("לא ניתן לאשר רשומה מסוג זה");
}

export async function completeInvoiceRecord(
  organizationId: string,
  sourceType: InvoiceCompletionSourceType,
  rawId: string,
  input: InvoiceCompletionRequest,
  options?: { userId?: string; sourceRoute?: string },
): Promise<InvoiceCompletionContext> {
  let ctx = await loadInvoiceCompletionContext(organizationId, sourceType, rawId);
  const hasFieldUpdates =
    input.supplier !== undefined ||
    input.amount !== undefined ||
    input.date !== undefined ||
    input.documentType !== undefined ||
    input.currency !== undefined;

  if (hasFieldUpdates) {
    ctx = await applyInvoiceCompletionFieldUpdates(ctx, input);
  }

  if (input.approve) {
    ctx = await approveInvoiceCompletionContext(organizationId, ctx, {
      userId: options?.userId,
      sourceRoute: options?.sourceRoute ?? "POST /api/invoices/:sourceType/:id/complete",
      supplier: input.supplier,
    });
    ctx = await loadInvoiceCompletionContext(organizationId, sourceType, rawId);
  }

  return ctx;
}

export function mapCompletionErrorStatus(message: string): number {
  if (message.includes("not found")) return 404;
  if (message.includes("חסום")) return 403;
  if (message.includes("לא ניתן לאשר")) return 422;
  if (message.includes("Cannot approve") || message.includes("אי אפשר")) return 422;
  return 400;
}
