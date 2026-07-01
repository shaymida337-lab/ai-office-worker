import { prisma } from "../../lib/prisma.js";
import { parseArcAmountSnapshot } from "../amount/financeDisplayAmount.js";
import { parseSupplierGateFromParsedFields } from "../supplier/supplierGate.js";
import { parseTrustGatesFromParsedFields } from "../trust/trustGatePersistence.js";
import { resolveWorkflowCorrelationId } from "../auditLog/index.js";
import type { AuditorEvaluationInput, PrimaryDecision } from "./auditorTypes.js";

export type AuditorEntityType =
  | "financial_document_review"
  | "gmail_scan_item"
  | "supplier_payment";

export type AuditorEntityDb = Pick<
  typeof prisma,
  "financialDocumentReview" | "gmailScanItem" | "supplierPayment"
>;

function parseConfidenceValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").trim());
    if (!Number.isFinite(parsed)) return null;
    return parsed > 1 ? parsed / 100 : parsed;
  }
  return null;
}

function isFinancialDocument(documentType: string): boolean {
  const normalized = documentType.toLowerCase();
  return !normalized.includes("non_financial") && normalized !== "junk" && normalized !== "irrelevant";
}

function trustFromParsedFields(parsedFieldsJson: unknown): {
  trustEngineConfidence: number | null;
  paymentDirection: string | null;
  documentType: string | null;
} {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") {
    return { trustEngineConfidence: null, paymentDirection: null, documentType: null };
  }
  const parsed = parsedFieldsJson as Record<string, unknown>;
  const trust = parsed.trust as { confidence?: number } | undefined;
  const paymentDirection =
    typeof parsed.paymentDirection === "string"
      ? parsed.paymentDirection
      : typeof (parsed.fields as Record<string, unknown> | undefined)?.paymentDirection === "string"
        ? ((parsed.fields as Record<string, unknown>).paymentDirection as string)
        : null;
  const documentType =
    typeof parsed.documentType === "string"
      ? parsed.documentType
      : typeof (parsed.fields as Record<string, unknown> | undefined)?.documentType === "string"
        ? ((parsed.fields as Record<string, unknown>).documentType as string)
        : null;

  return {
    trustEngineConfidence: typeof trust?.confidence === "number" ? trust.confidence : null,
    paymentDirection,
    documentType,
  };
}

function invoiceFromParsedFields(parsedFieldsJson: unknown): string | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") return null;
  const parsed = parsedFieldsJson as Record<string, unknown>;
  const fields = parsed.fields as Record<string, unknown> | undefined;
  const candidates = [
    fields?.invoiceNumber,
    fields?.invoice_number,
    parsed.invoiceNumber,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buildIndependentSignals(parsedFieldsJson: unknown, fallbackDocumentType: string) {
  const gates = parseTrustGatesFromParsedFields(parsedFieldsJson);
  const arc = parseArcAmountSnapshot(parsedFieldsJson);
  const supplierGate = parseSupplierGateFromParsedFields(parsedFieldsJson);
  const trust = trustFromParsedFields(parsedFieldsJson);
  const documentType = trust.documentType ?? fallbackDocumentType;

  return {
    supplierName: supplierGate?.canonicalSupplierName ?? null,
    amount: arc?.selectedAmount ?? gates.amountGate?.normalizedAmount ?? null,
    invoiceNumber: invoiceFromParsedFields(parsedFieldsJson),
    documentType,
    paymentDirection: trust.paymentDirection,
    confidenceScore:
      trust.trustEngineConfidence != null
        ? trust.trustEngineConfidence > 1
          ? trust.trustEngineConfidence / 100
          : trust.trustEngineConfidence
        : null,
    isFinancial: isFinancialDocument(documentType),
    isDuplicate: gates.duplicateGate?.verdict === "block",
    isDuplicateSuspicion: gates.duplicateGate?.verdict === "review",
  };
}

export async function buildAuditorInputFromEntity(
  organizationId: string,
  entityType: AuditorEntityType,
  entityId: string,
  db: AuditorEntityDb = prisma,
): Promise<AuditorEvaluationInput | null> {
  if (entityType === "financial_document_review") {
    const review = await db.financialDocumentReview.findFirst({
      where: { id: entityId, organizationId },
    });
    if (!review) return null;

    const primary: PrimaryDecision = {
      organizationId,
      entityType,
      entityId,
      correlationId: resolveWorkflowCorrelationId({
        gmailMessageId: review.gmailMessageId,
        emailMessageId: review.emailMessageId,
      }),
      supplierName: review.supplierName,
      amount: review.totalAmount,
      invoiceNumber: review.invoiceNumber,
      documentType: review.documentType,
      paymentDirection: trustFromParsedFields(review.parsedFieldsJson).paymentDirection,
      confidenceScore: parseConfidenceValue(review.confidenceScore),
      isFinancial: isFinancialDocument(review.documentType),
      isDuplicate: review.reviewStatus === "duplicate",
      isDuplicateSuspicion: review.reviewStatus === "duplicate" || review.reviewStatus === "needs_review",
      autoExecuteRecommended: review.reviewStatus === "approved",
      crossOrgMismatch: false,
    };

    return {
      primary,
      independent: buildIndependentSignals(review.parsedFieldsJson, review.documentType),
    };
  }

  if (entityType === "gmail_scan_item") {
    const item = await db.gmailScanItem.findFirst({
      where: { id: entityId, organizationId },
    });
    if (!item) return null;

    const primary: PrimaryDecision = {
      organizationId,
      entityType,
      entityId,
      correlationId: resolveWorkflowCorrelationId({
        gmailMessageId: item.gmailMessageId,
        emailMessageId: item.emailMessageId,
      }),
      supplierName: item.supplierName,
      amount: item.amount,
      invoiceNumber: null,
      documentType: item.documentType ?? "unknown",
      paymentDirection: trustFromParsedFields(item.parsedFieldsJson).paymentDirection,
      confidenceScore: parseConfidenceValue(item.confidenceScore),
      isFinancial: isFinancialDocument(item.documentType ?? "unknown"),
      isDuplicate: item.reviewStatus === "duplicate",
      isDuplicateSuspicion: item.reviewStatus === "needs_review",
      autoExecuteRecommended: item.reviewStatus === "approved",
      crossOrgMismatch: false,
    };

    return {
      primary,
      independent: buildIndependentSignals(item.parsedFieldsJson, item.documentType ?? "unknown"),
    };
  }

  const payment = await db.supplierPayment.findFirst({
    where: { id: entityId, organizationId },
  });
  if (!payment) return null;

  const documentType = payment.documentTypeDetailed ?? "tax_invoice";
  const primary: PrimaryDecision = {
    organizationId,
    entityType,
    entityId,
    correlationId: resolveWorkflowCorrelationId({ emailMessageId: payment.emailMessageId }),
    supplierName: payment.supplier,
    amount: payment.amount,
    invoiceNumber: payment.invoiceNumber,
    documentType,
    paymentDirection: trustFromParsedFields(payment.parsedFieldsJson).paymentDirection ?? "incoming_expense",
    confidenceScore: parseConfidenceValue(payment.confidenceScore),
    isFinancial: isFinancialDocument(documentType),
    isDuplicate: payment.duplicateDetected,
    isDuplicateSuspicion: payment.duplicateDetected,
    autoExecuteRecommended: payment.approvalStatus === "approved",
    crossOrgMismatch: false,
  };

  return {
    primary,
    independent: buildIndependentSignals(payment.parsedFieldsJson, documentType),
  };
}
