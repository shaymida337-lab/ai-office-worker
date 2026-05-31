import { createHash } from "crypto";
import { prisma } from "../lib/prisma.js";

export type FinancialDocumentSource = "gmail" | "whatsapp";

export type NormalizedFinancialDocumentType =
  | "tax_invoice"
  | "receipt"
  | "tax_invoice_receipt"
  | "payment_request"
  | "quote"
  | "irrelevant";

export type FinancialDocumentInput = {
  organizationId: string;
  source: FinancialDocumentSource;
  sender?: string | null;
  subject?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  documentDate?: Date | string | null;
  dueDate?: Date | string | null;
  amountBeforeVat?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  documentType: string;
  driveFileUrl?: string | null;
  confidenceScore?: number | null;
  uncertaintyReason?: string | null;
  rawAnalysis?: unknown;
  emailMessageId?: string | null;
  gmailMessageId?: string | null;
  whatsappLogId?: string | null;
};

export function normalizeFinancialDocumentType(value: string | null | undefined): NormalizedFinancialDocumentType {
  const normalized = (value ?? "").toLowerCase();
  if (/tax_invoice_receipt|invoice_receipt|חשבונית\s*מס\s*קבלה/.test(normalized)) return "tax_invoice_receipt";
  if (/quote|proposal|estimate|הצעת\s*מחיר/.test(normalized)) return "quote";
  if (/payment_request|payment request|דרישת|בקשת/.test(normalized)) return "payment_request";
  if (/receipt|קבלה/.test(normalized)) return "receipt";
  if (/invoice|tax_invoice|חשבונית/.test(normalized)) return "tax_invoice";
  return "irrelevant";
}

export function isPaymentDocumentType(type: NormalizedFinancialDocumentType) {
  return type === "tax_invoice" || type === "receipt" || type === "tax_invoice_receipt" || type === "payment_request";
}

export function buildFinancialDocumentFingerprint(input: {
  source?: string | null;
  sender?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  amount?: number | null;
  invoiceNumber?: string | null;
  date?: Date | string | null;
}) {
  return hashFingerprint([
    input.source ?? "unknown",
    input.sender ?? "unknown",
    input.fileName ?? "no-file",
    input.fileSize == null ? "unknown-size" : String(input.fileSize),
    input.amount == null ? "unknown-amount" : input.amount.toFixed(2),
    input.invoiceNumber ?? "unknown-invoice",
    normalizeDateKey(input.date),
  ]);
}

export function buildCrossSourceFinancialFingerprint(input: Omit<Parameters<typeof buildFinancialDocumentFingerprint>[0], "source">) {
  return hashFingerprint([
    input.sender ?? "unknown",
    input.fileName ?? "no-file",
    input.fileSize == null ? "unknown-size" : String(input.fileSize),
    input.amount == null ? "unknown-amount" : input.amount.toFixed(2),
    input.invoiceNumber ?? "unknown-invoice",
    normalizeDateKey(input.date),
  ]);
}

export async function recordFinancialDocumentDecision(input: FinancialDocumentInput) {
  const documentType = normalizeFinancialDocumentType(input.documentType);
  const totalAmount = input.totalAmount ?? null;
  const documentDate = parseDate(input.documentDate);
  const dueDate = parseDate(input.dueDate);
  const confidenceScore = clampConfidence(input.confidenceScore);
  const sourceFingerprint = buildFinancialDocumentFingerprint({
    source: input.source,
    sender: input.sender,
    fileName: input.fileName,
    fileSize: input.fileSize,
    amount: totalAmount,
    invoiceNumber: input.invoiceNumber,
    date: documentDate,
  });
  const documentFingerprint = buildCrossSourceFinancialFingerprint({
    sender: input.supplierName ?? input.sender,
    fileName: input.fileName,
    fileSize: input.fileSize,
    amount: totalAmount,
    invoiceNumber: input.invoiceNumber,
    date: documentDate,
  });

  if (!isPaymentDocumentType(documentType)) {
    await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, sourceFingerprint, documentFingerprint, reviewStatus: "rejected", uncertaintyReason: input.uncertaintyReason ?? "מסמך לא רלוונטי" });
    console.log(`[financial-document] filtered_irrelevant source=${input.source} fingerprint=${documentFingerprint} type=${documentType}`);
    return { action: "filtered" as const, documentType, sourceFingerprint, documentFingerprint };
  }

  const existingPayment = await prisma.supplierPayment.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: [
        { documentFingerprint },
        { sourceFingerprint },
      ],
    },
  });

  if (existingPayment) {
    const sources = mergeSources(existingPayment.sourcesJson, input.source);
    const updated = await prisma.supplierPayment.update({
      where: { id: existingPayment.id },
      data: {
        source: sources.includes("gmail") && sources.includes("whatsapp") ? "both" : existingPayment.source,
        lastSource: input.source,
        sourceCount: sources.length,
        sourcesJson: sources,
        duplicateDetected: true,
        duplicateReason: existingPayment.source === input.source ? "same_source_fingerprint" : "cross_source_fingerprint",
        supplierTaxId: input.supplierTaxId ?? existingPayment.supplierTaxId,
        documentTypeDetailed: documentType,
        amountBeforeVat: input.amountBeforeVat ?? existingPayment.amountBeforeVat,
        vatAmount: input.vatAmount ?? existingPayment.vatAmount,
        totalAmount: totalAmount ?? existingPayment.totalAmount,
        confidenceScore: Math.max(existingPayment.confidenceScore ?? 0, confidenceScore),
        driveFileUrl: input.driveFileUrl ?? existingPayment.driveFileUrl,
        invoiceLink: isInvoiceLike(documentType) ? input.driveFileUrl ?? existingPayment.invoiceLink : existingPayment.invoiceLink,
        documentLink: input.driveFileUrl ?? existingPayment.documentLink,
        lastSeenAt: new Date(),
      },
    });
    await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, sourceFingerprint, documentFingerprint, reviewStatus: "duplicate", supplierPaymentId: updated.id, uncertaintyReason: "זוהתה כפילות - הרשומה הקיימת עודכנה" });
    console.log(`[financial-document] duplicate source=${input.source} paymentId=${updated.id} fingerprint=${documentFingerprint}`);
    return { action: "duplicate" as const, documentType, sourceFingerprint, documentFingerprint, payment: updated };
  }

  if (confidenceScore < 0.8) {
    const review = await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, sourceFingerprint, documentFingerprint, reviewStatus: "needs_review", uncertaintyReason: input.uncertaintyReason ?? `confidence below 80% (${Math.round(confidenceScore * 100)}%)` });
    console.log(`[financial-document] needs_review source=${input.source} reviewId=${review.id} confidence=${confidenceScore}`);
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  return { action: "accepted" as const, documentType, sourceFingerprint, documentFingerprint };
}

export async function approveFinancialDocumentReview(organizationId: string, reviewId: string) {
  const review = await prisma.financialDocumentReview.findFirst({ where: { id: reviewId, organizationId } });
  if (!review) throw new Error("Document review item not found");
  if (!isPaymentDocumentType(normalizeFinancialDocumentType(review.documentType))) {
    return prisma.financialDocumentReview.update({ where: { id: review.id }, data: { reviewStatus: "rejected", uncertaintyReason: "מסמך לא רלוונטי" } });
  }
  const payment = await prisma.supplierPayment.upsert({
    where: { organizationId_documentFingerprint: { organizationId, documentFingerprint: review.documentFingerprint } },
    create: {
      organizationId,
      supplier: review.supplierName || "לא מזוהה",
      amount: review.totalAmount ?? 0,
      currency: review.currency,
      date: review.documentDate ?? new Date(),
      dueDate: review.dueDate,
      paid: review.documentType === "receipt" || review.documentType === "tax_invoice_receipt",
      documentLink: review.driveFileUrl,
      invoiceLink: isInvoiceLike(normalizeFinancialDocumentType(review.documentType)) ? review.driveFileUrl : null,
      emailSender: review.sender,
      paymentRequired: review.documentType !== "receipt",
      missingInvoice: review.documentType === "payment_request",
      duplicateHash: review.documentFingerprint,
      subject: review.subject,
      source: review.source,
      firstSource: review.source,
      lastSource: review.source,
      sourceCount: 1,
      documentFingerprint: review.documentFingerprint,
      sourceFingerprint: review.sourceFingerprint,
      documentTypeDetailed: review.documentType,
      supplierTaxId: review.supplierTaxId,
      amountBeforeVat: review.amountBeforeVat,
      vatAmount: review.vatAmount,
      totalAmount: review.totalAmount,
      confidenceScore: review.confidenceScore,
      approvalStatus: "approved",
      sourcesJson: [review.source],
      emailMessageId: review.emailMessageId,
    },
    update: {
      approvalStatus: "approved",
      confidenceScore: review.confidenceScore,
      lastSeenAt: new Date(),
    },
  });
  console.log(`[financial-document] manually_approved reviewId=${review.id} paymentId=${payment.id}`);
  return prisma.financialDocumentReview.update({ where: { id: review.id }, data: { reviewStatus: "approved", supplierPaymentId: payment.id } });
}

export async function deleteFinancialDocumentReview(organizationId: string, reviewId: string) {
  const deleted = await prisma.financialDocumentReview.deleteMany({ where: { id: reviewId, organizationId } });
  console.log(`[financial-document] review_deleted reviewId=${reviewId} count=${deleted.count}`);
  return deleted;
}

async function upsertReview(input: FinancialDocumentInput & {
  documentType: NormalizedFinancialDocumentType;
  documentDate: Date | null;
  dueDate: Date | null;
  confidenceScore: number;
  sourceFingerprint: string;
  documentFingerprint: string;
  reviewStatus: string;
  uncertaintyReason?: string | null;
  supplierPaymentId?: string | null;
}) {
  return prisma.financialDocumentReview.upsert({
    where: { organizationId_documentFingerprint: { organizationId: input.organizationId, documentFingerprint: input.documentFingerprint } },
    create: {
      organizationId: input.organizationId,
      source: input.source,
      sender: input.sender,
      subject: input.subject,
      fileName: input.fileName,
      fileSize: input.fileSize == null ? null : Math.trunc(input.fileSize),
      sourceFingerprint: input.sourceFingerprint,
      documentFingerprint: input.documentFingerprint,
      documentType: input.documentType,
      supplierName: input.supplierName,
      supplierTaxId: input.supplierTaxId,
      invoiceNumber: input.invoiceNumber,
      documentDate: input.documentDate,
      dueDate: input.dueDate,
      amountBeforeVat: input.amountBeforeVat,
      vatAmount: input.vatAmount,
      totalAmount: input.totalAmount,
      driveFileUrl: input.driveFileUrl,
      confidenceScore: input.confidenceScore,
      reviewStatus: input.reviewStatus,
      uncertaintyReason: input.uncertaintyReason,
      rawAnalysis: input.rawAnalysis as any,
      emailMessageId: input.emailMessageId,
      gmailMessageId: input.gmailMessageId,
      whatsappLogId: input.whatsappLogId,
      supplierPaymentId: input.supplierPaymentId,
    },
    update: {
      source: input.source,
      sender: input.sender,
      subject: input.subject,
      fileName: input.fileName,
      fileSize: input.fileSize == null ? undefined : Math.trunc(input.fileSize),
      sourceFingerprint: input.sourceFingerprint,
      documentType: input.documentType,
      supplierName: input.supplierName,
      supplierTaxId: input.supplierTaxId,
      invoiceNumber: input.invoiceNumber,
      documentDate: input.documentDate,
      dueDate: input.dueDate,
      amountBeforeVat: input.amountBeforeVat,
      vatAmount: input.vatAmount,
      totalAmount: input.totalAmount,
      driveFileUrl: input.driveFileUrl,
      confidenceScore: input.confidenceScore,
      reviewStatus: input.reviewStatus,
      uncertaintyReason: input.uncertaintyReason,
      rawAnalysis: input.rawAnalysis as any,
      supplierPaymentId: input.supplierPaymentId,
    },
  });
}

function hashFingerprint(parts: Array<string | number | null | undefined>) {
  const normalized = parts.map((part) => String(part ?? "").trim().toLowerCase()).join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 48);
}

function parseDate(value: Date | string | null | undefined) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function normalizeDateKey(value: Date | string | null | undefined) {
  return parseDate(value)?.toISOString().slice(0, 10) ?? "unknown-date";
}

function clampConfidence(value: number | null | undefined) {
  return Math.max(0, Math.min(1, Number.isFinite(value ?? NaN) ? Number(value) : 0));
}

function mergeSources(existing: unknown, source: string) {
  const values = Array.isArray(existing) ? existing.filter((item): item is string => typeof item === "string") : [];
  return Array.from(new Set([...values, source]));
}

function isInvoiceLike(type: NormalizedFinancialDocumentType) {
  return type === "tax_invoice" || type === "receipt" || type === "tax_invoice_receipt";
}

