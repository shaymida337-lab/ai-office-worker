import { prisma } from "../../lib/prisma.js";
import { parseTrustGatesFromParsedFields, trustGatesFailClosedReason } from "../trust/trustGatePersistence.js";
import { resolveWorkflowCorrelationId } from "../auditLog/index.js";
import type { ConfidenceEvaluationInput } from "./confidenceTypes.js";

function parseConfidenceValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  if (typeof value === "string") {
    const parsed = Number(value.replace("%", "").trim());
    if (!Number.isFinite(parsed)) return null;
    return parsed > 1 ? parsed / 100 : parsed;
  }
  return null;
}

export type ConfidenceEntityType =
  | "financial_document_review"
  | "gmail_scan_item"
  | "supplier_payment";

export type ConfidenceEntityDb = Pick<
  typeof prisma,
  "financialDocumentReview" | "gmailScanItem" | "supplierPayment"
>;

function trustFromParsedFields(parsedFieldsJson: unknown): {
  trustEngineConfidence: number | null;
  historicalConsistency: number | null;
  paymentDirection: string | null;
  ocrConfidence: number | null;
} {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object") {
    return { trustEngineConfidence: null, historicalConsistency: null, paymentDirection: null, ocrConfidence: null };
  }
  const parsed = parsedFieldsJson as Record<string, unknown>;
  const trust = parsed.trust as { confidence?: number; contributors?: Array<{ score?: number }> } | undefined;
  const fse = parsed.fse as { ocrConfidence?: number } | undefined;
  const paymentDirection =
    typeof parsed.paymentDirection === "string"
      ? parsed.paymentDirection
      : typeof (parsed.fields as Record<string, unknown> | undefined)?.paymentDirection === "string"
        ? ((parsed.fields as Record<string, unknown>).paymentDirection as string)
        : null;

  const contributorScores = trust?.contributors?.map((item) => item.score).filter((s): s is number => typeof s === "number") ?? [];
  const historicalConsistency =
    contributorScores.length > 1
      ? contributorScores.reduce((sum, score) => sum + score, 0) / contributorScores.length / 100
      : null;

  return {
    trustEngineConfidence: typeof trust?.confidence === "number" ? trust.confidence : null,
    historicalConsistency,
    paymentDirection,
    ocrConfidence: typeof fse?.ocrConfidence === "number" ? fse.ocrConfidence : null,
  };
}

function gatesToSignals(parsedFieldsJson: unknown) {
  const gates = parseTrustGatesFromParsedFields(parsedFieldsJson);
  const gateFailure = trustGatesFailClosedReason(gates);
  return {
    hasConflictingAmounts:
      gates.amountGate?.verdict === "review" &&
      Boolean(gates.amountGate?.reasonCode?.includes("conflict")),
    isDuplicateSuspicion: gates.duplicateGate?.verdict === "review",
    isConfirmedDuplicate: gates.duplicateGate?.verdict === "block",
    missingSupplier: gates.supplierGate?.verdict !== "pass",
    businessRuleViolations: gateFailure ? [gateFailure] : [],
    supplierMatchConfidence:
      gates.supplierGate?.verdict === "pass" ? 0.95 : gates.supplierGate ? 0.4 : null,
    amountConfidence: gates.amountGate?.verdict === "pass" ? 0.95 : gates.amountGate ? 0.5 : null,
  };
}

export async function buildConfidenceInputFromEntity(
  organizationId: string,
  entityType: ConfidenceEntityType,
  entityId: string,
  db: ConfidenceEntityDb = prisma,
): Promise<ConfidenceEvaluationInput | null> {
  if (entityType === "financial_document_review") {
    const review = await db.financialDocumentReview.findFirst({
      where: { id: entityId, organizationId },
    });
    if (!review) return null;
    const trust = trustFromParsedFields(review.parsedFieldsJson);
    const gateSignals = gatesToSignals(review.parsedFieldsJson);
    return {
      organizationId,
      entityType,
      entityId,
      correlationId: resolveWorkflowCorrelationId({
        gmailMessageId: review.gmailMessageId,
        emailMessageId: review.emailMessageId,
      }),
      confidenceScore: parseConfidenceValue(review.confidenceScore),
      ocrConfidence: trust.ocrConfidence,
      amount: review.totalAmount,
      amountConfidence: gateSignals.amountConfidence,
      supplierName: review.supplierName,
      supplierMatchConfidence: gateSignals.supplierMatchConfidence,
      documentType: review.documentType,
      paymentDirection: trust.paymentDirection,
      hasAttachment: Boolean(review.fileName || review.driveFileUrl),
      isDuplicateSuspicion: gateSignals.isDuplicateSuspicion || review.reviewStatus === "duplicate",
      isConfirmedDuplicate: gateSignals.isConfirmedDuplicate,
      hasConflictingAmounts: gateSignals.hasConflictingAmounts,
      missingSupplier: gateSignals.missingSupplier || !review.supplierName,
      unsupportedDocument: review.reviewStatus === "rejected",
      corruptedDocument: false,
      sourceTrusted: true,
      permissionDenied: false,
      crossOrgMismatch: false,
      integrityCritical: false,
      integrityWarning: review.reviewStatus === "needs_review",
      businessRuleViolations: gateSignals.businessRuleViolations,
      aiAuditorObjections: [],
      trustEngineConfidence: trust.trustEngineConfidence,
      historicalConsistency: trust.historicalConsistency,
    };
  }

  if (entityType === "gmail_scan_item") {
    const item = await db.gmailScanItem.findFirst({
      where: { id: entityId, organizationId },
    });
    if (!item) return null;
    const trust = trustFromParsedFields(item.parsedFieldsJson);
    const gateSignals = gatesToSignals(item.parsedFieldsJson);
    return {
      organizationId,
      entityType,
      entityId,
      correlationId: resolveWorkflowCorrelationId({
        gmailMessageId: item.gmailMessageId,
        emailMessageId: item.emailMessageId,
      }),
      confidenceScore: parseConfidenceValue(item.confidenceScore),
      ocrConfidence: trust.ocrConfidence,
      amount: item.amount,
      amountConfidence: gateSignals.amountConfidence,
      supplierName: item.supplierName,
      supplierMatchConfidence: gateSignals.supplierMatchConfidence,
      documentType: item.documentType ?? "unknown",
      paymentDirection: trust.paymentDirection,
      hasAttachment: Boolean(item.attachmentFilename || item.driveFileLink),
      isDuplicateSuspicion: gateSignals.isDuplicateSuspicion,
      isConfirmedDuplicate: gateSignals.isConfirmedDuplicate,
      hasConflictingAmounts: gateSignals.hasConflictingAmounts,
      missingSupplier: gateSignals.missingSupplier || !item.supplierName,
      unsupportedDocument: item.reviewStatus === "rejected",
      corruptedDocument: false,
      sourceTrusted: true,
      permissionDenied: false,
      crossOrgMismatch: false,
      integrityCritical: false,
      integrityWarning: item.reviewStatus === "needs_review",
      businessRuleViolations: gateSignals.businessRuleViolations,
      aiAuditorObjections: [],
      trustEngineConfidence: trust.trustEngineConfidence,
      historicalConsistency: trust.historicalConsistency,
    };
  }

  const payment = await db.supplierPayment.findFirst({
    where: { id: entityId, organizationId },
  });
  if (!payment) return null;
  const trust = trustFromParsedFields(payment.parsedFieldsJson);
  const gateSignals = gatesToSignals(payment.parsedFieldsJson);
  return {
    organizationId,
    entityType,
    entityId,
    correlationId: resolveWorkflowCorrelationId({ emailMessageId: payment.emailMessageId }),
      confidenceScore: parseConfidenceValue(payment.confidenceScore),
    ocrConfidence: trust.ocrConfidence,
    amount: payment.amount,
    amountConfidence: gateSignals.amountConfidence,
    supplierName: payment.supplier,
    supplierMatchConfidence: gateSignals.supplierMatchConfidence,
    documentType: payment.documentTypeDetailed ?? "tax_invoice",
    paymentDirection: trust.paymentDirection ?? "incoming_expense",
    hasAttachment: Boolean(payment.documentLink || payment.invoiceLink),
    isDuplicateSuspicion: payment.duplicateDetected,
    isConfirmedDuplicate: payment.duplicateDetected && Boolean(payment.duplicateReason),
    hasConflictingAmounts: gateSignals.hasConflictingAmounts,
    missingSupplier: !payment.supplier,
    unsupportedDocument: false,
    corruptedDocument: false,
    sourceTrusted: true,
    permissionDenied: false,
    crossOrgMismatch: false,
    integrityCritical: false,
    integrityWarning: false,
    businessRuleViolations: gateSignals.businessRuleViolations,
    aiAuditorObjections: [],
    trustEngineConfidence: trust.trustEngineConfidence,
    historicalConsistency: trust.historicalConsistency,
  };
}
