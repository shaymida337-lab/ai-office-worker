import { createHash } from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  computeCanonicalFingerprint,
  matchFinancialDocuments,
  type DedupMatchResult,
  type FinancialDocumentFingerprintInput,
} from "./dedup/sharedMatcher.js";
import {
  buildLegacyDuplicateHashForLookup,
  buildSupplierPaymentLookupClauses,
  logFingerprintShadowMode,
} from "./dedup/fingerprintMigration.js";
import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "./financialAmountLimits.js";
import {
  amountGatePasses,
  evaluateAmountGate,
  FINANCE_AMOUNT_UNRESOLVED_REASON,
  parseAmountGateFromParsedFields,
  type AmountGateSnapshot,
  type FseSummaryForAmountGate,
} from "./amount/amountGate.js";
import type { MoneyDecision } from "./amount/canonicalAmount.js";
import {
  evaluateSupplierGate,
  parseSupplierGateFromParsedFields,
  supplierGatePasses,
  type SupplierGateSnapshot,
} from "./supplier/supplierGate.js";
import type { SupplierDecision } from "./supplier/supplierTypes.js";
import {
  buildFingerprintGateInputFromReview,
  evaluateFingerprintGate,
  fingerprintGatePasses,
  type FingerprintGateSnapshot,
} from "./dedup/fingerprintGate.js";
import type { FingerprintIdentityStability } from "./dedup/fingerprintGate.js";
import {
  duplicateGatePasses,
  fseDuplicateSuspicionFlags,
  type DuplicateGateInput,
  type DuplicateGateSnapshot,
} from "./dedup/duplicateGate.js";
import {
  allTrustGatesPass,
  parseTrustGatesFromParsedFields,
  trustGatesFailClosedReason,
} from "./trust/trustGatePersistence.js";
import {
  createSupplierPaymentIfTrusted,
  evaluateFreshTrustGatesForManualApproval,
} from "./trust/financeTrustPersistence.js";
import { isLikelyJunkSupplierName } from "./supplierNameValidation.js";
import {
  isCanonicalFinanceAmountResolved,
  resolveDocumentReviewDisplayAmount,
} from "./amount/financeDisplayAmount.js";

export type FinancialDocumentSource = "gmail" | "whatsapp" | "camera";

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
  parsedFieldsJson?: unknown;
  rawAnalysis?: unknown;
  emailMessageId?: string | null;
  gmailMessageId?: string | null;
  whatsappLogId?: string | null;
  fileSha256?: string | null;
  forceNeedsReview?: boolean;
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
    input.amount == null ? "unknown-amount" : input.amount.toFixed(2),
    input.invoiceNumber ?? "unknown-invoice",
    normalizeDateKey(input.date),
  ]);
}

export function financialDocumentAmountBlockingReason(input: {
  moneyDecision?: MoneyDecision | null;
  fseSummary?: FseSummaryForAmountGate;
  amountGate?: AmountGateSnapshot | null;
}): string | null {
  const gate =
    input.amountGate ??
    (input.moneyDecision
      ? evaluateAmountGate({ moneyDecision: input.moneyDecision, fseSummary: input.fseSummary })
      : null);
  if (!gate || amountGatePasses(gate)) return null;
  return gate.reasonCode;
}

export function financialDocumentSupplierBlockingReason(input: {
  supplierDecision?: SupplierDecision | null;
  supplierName?: string | null;
  supplierGate?: SupplierGateSnapshot | null;
  ownerEmails?: Set<string>;
}): string | null {
  if (input.supplierGate) {
    return supplierGatePasses(input.supplierGate) ? null : input.supplierGate.reasonCode;
  }
  if (input.supplierDecision) {
    const gate = evaluateSupplierGate({
      supplierDecision: input.supplierDecision,
      supplierName: input.supplierName,
      ownerEmails: input.ownerEmails,
    });
    return supplierGatePasses(gate) ? null : gate.reasonCode;
  }
  if (!isValidSupplierName(input.supplierName)) return "supplier.sir_missing";
  return null;
}

export function financialDocumentFingerprintBlockingReason(input: {
  fingerprintGate?: FingerprintGateSnapshot | null;
  fingerprintGateInput?: Parameters<typeof evaluateFingerprintGate>[0] | null;
}): string | null {
  if (input.fingerprintGate) {
    return fingerprintGatePasses(input.fingerprintGate) ? null : input.fingerprintGate.reasonCode;
  }
  if (input.fingerprintGateInput) {
    const gate = evaluateFingerprintGate(input.fingerprintGateInput);
    return fingerprintGatePasses(gate) ? null : gate.reasonCode;
  }
  return null;
}

export function financialDocumentDuplicateBlockingReason(input: {
  duplicateGate?: DuplicateGateSnapshot | null;
}): string | null {
  if (input.duplicateGate) {
    return duplicateGatePasses(input.duplicateGate) ? null : input.duplicateGate.reasonCode;
  }
  return null;
}

export function financialDocumentTrustGatesBlockingReason(parsedFieldsJson: unknown): string | null {
  if (parsedFieldsJson === undefined) return null;
  return trustGatesFailClosedReason(parseTrustGatesFromParsedFields(parsedFieldsJson));
}

export function financialDocumentBlockingReason(input: {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  documentDate?: Date | string | null;
  moneyDecision?: MoneyDecision | null;
  fseSummary?: FseSummaryForAmountGate;
  amountGate?: AmountGateSnapshot | null;
  supplierDecision?: SupplierDecision | null;
  supplierGate?: SupplierGateSnapshot | null;
  fingerprintGate?: FingerprintGateSnapshot | null;
  fingerprintGateInput?: Parameters<typeof evaluateFingerprintGate>[0] | null;
  duplicateGate?: DuplicateGateSnapshot | null;
  ownerEmails?: Set<string>;
  parsedFieldsJson?: unknown;
}) {
  const gates = input.parsedFieldsJson !== undefined ? parseTrustGatesFromParsedFields(input.parsedFieldsJson) : {
    amountGate: null,
    supplierGate: null,
    fingerprintGate: null,
    duplicateGate: null,
  };
  const amountReason = financialDocumentAmountBlockingReason({
    moneyDecision: input.moneyDecision,
    fseSummary: input.fseSummary,
    amountGate: input.amountGate ?? gates.amountGate,
  });
  if (amountReason) return amountReason;

  const supplierReason = financialDocumentSupplierBlockingReason({
    supplierDecision: input.supplierDecision,
    supplierName: input.supplierName,
    supplierGate: input.supplierGate ?? gates.supplierGate,
    ownerEmails: input.ownerEmails,
  });
  if (supplierReason) return supplierReason;

  const fingerprintReason = financialDocumentFingerprintBlockingReason({
    fingerprintGate: input.fingerprintGate ?? gates.fingerprintGate,
    fingerprintGateInput: input.fingerprintGateInput,
  });
  if (fingerprintReason) return fingerprintReason;

  const duplicateReason = financialDocumentDuplicateBlockingReason({
    duplicateGate: input.duplicateGate ?? gates.duplicateGate,
  });
  if (duplicateReason) return duplicateReason;

  if (!isValidSupplierName(input.supplierName)) return "supplier.sir_missing";
  if (!input.invoiceNumber?.trim()) return "invoice number missing";
  if (input.totalAmount == null || !Number.isFinite(input.totalAmount) || input.totalAmount <= 0) {
    return FINANCE_AMOUNT_UNRESOLVED_REASON;
  }
  if (input.totalAmount >= MAX_REASONABLE_FINANCIAL_AMOUNT) return "amount.threshold_exceeded";
  if (!parseDate(input.documentDate)) return "invoice date missing or invalid";
  return null;
}

export type ExistingFinancialDocumentCandidate = {
  id: string;
  supplier?: string | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  totalAmount?: number | null;
  date?: Date | string | null;
  documentTypeDetailed?: string | null;
  documentFingerprint?: string | null;
  sourceFingerprint?: string | null;
  duplicateHash?: string | null;
};

export function matchExistingFinancialDocumentCandidate(input: {
  current: FinancialDocumentFingerprintInput;
  candidates: ExistingFinancialDocumentCandidate[];
}): {
  result: DedupMatchResult;
  candidate: ExistingFinancialDocumentCandidate | null;
  reasons: string[];
} {
  let unsure: { candidate: ExistingFinancialDocumentCandidate; reasons: string[] } | null = null;
  for (const candidate of input.candidates) {
    const candidateInput: FinancialDocumentFingerprintInput = {
      organizationId: input.current.organizationId,
      supplierName: candidate.supplierName ?? candidate.supplier,
      supplierTaxId: candidate.supplierTaxId,
      invoiceNumber: candidate.invoiceNumber,
      totalAmount: candidate.totalAmount ?? candidate.amount,
      documentDate: candidate.date,
      documentType: candidate.documentTypeDetailed,
    };
    const match = matchFinancialDocuments(input.current, candidateInput);
    if (match.result === "MATCH") {
      return { result: "MATCH", candidate, reasons: match.reasons };
    }
    if (match.result === "UNSURE" && !unsure) {
      unsure = { candidate, reasons: match.reasons };
    }
  }
  if (unsure) return { result: "UNSURE", candidate: unsure.candidate, reasons: unsure.reasons };
  return { result: "NO_MATCH", candidate: null, reasons: ["no_candidate_match"] };
}

export async function buildDuplicateGateInput(input: {
  organizationId: string;
  source: FinancialDocumentSource;
  sender?: string | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  documentDate?: Date | string | null;
  documentType?: string;
  fileSha256?: string | null;
  documentFingerprint: string;
  legacyDuplicateHash: string;
  legacyDuplicateKey?: string | null;
  scfcFingerprint?: string | null;
  emailMessageId?: string | null;
  forceReprocess?: boolean;
  identityStability?: FingerprintIdentityStability;
  amountRecoveredOnRescan?: boolean;
  parsedFieldsJson?: unknown;
  sameEmailAttachmentMatch?: boolean;
}): Promise<DuplicateGateInput> {
  const documentType = normalizeFinancialDocumentType(input.documentType);
  const totalAmount = input.totalAmount ?? null;
  const documentDate = parseDate(input.documentDate);
  const sourceFingerprint = buildFinancialDocumentFingerprint({
    source: input.source,
    sender: input.sender,
    fileName: null,
    fileSize: null,
    amount: totalAmount,
    invoiceNumber: input.invoiceNumber,
    date: documentDate,
  });
  const legacyDocumentFingerprint = buildCrossSourceFinancialFingerprint({
    sender: input.supplierName ?? input.sender,
    amount: totalAmount,
    invoiceNumber: input.invoiceNumber,
    date: documentDate,
  });
  const duplicateCandidateWhere = buildSupplierPaymentLookupClauses({
    canonicalFingerprint: input.documentFingerprint,
    legacySemanticFingerprint: input.scfcFingerprint ?? input.documentFingerprint,
    legacyCrossSourceFingerprint: legacyDocumentFingerprint,
    sourceFingerprint,
    legacyDuplicateHash: input.legacyDuplicateHash,
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    totalAmount,
    documentDate,
  });
  const duplicateCandidates = await prisma.supplierPayment.findMany({
    where: {
      organizationId: input.organizationId,
      OR: duplicateCandidateWhere,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const duplicateMatch = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: input.organizationId,
      supplierName: input.supplierName ?? input.sender,
      supplierTaxId: input.supplierTaxId,
      invoiceNumber: input.invoiceNumber,
      totalAmount,
      documentDate,
      documentType,
      fileSha256: input.fileSha256,
    },
    candidates: duplicateCandidates,
  });
  const duplicateSuspicion = fseDuplicateSuspicionFlags(input.parsedFieldsJson);
  const fullCandidate = duplicateMatch.candidate
    ? duplicateCandidates.find((candidate) => candidate.id === duplicateMatch.candidate?.id) ?? null
    : null;
  const candidateSource = fullCandidate?.lastSource ?? fullCandidate?.source ?? null;
  const crossChannelUnsure =
    duplicateMatch.result === "UNSURE" &&
    Boolean(candidateSource && candidateSource !== input.source);
  return {
    matchResult: duplicateMatch.result,
    matchReasons: duplicateMatch.reasons,
    matchedCandidate: fullCandidate
      ? {
          id: fullCandidate.id,
          source: fullCandidate.source,
          lastSource: fullCandidate.lastSource,
          sourcesJson: fullCandidate.sourcesJson,
          documentFingerprint: fullCandidate.documentFingerprint,
          emailMessageId: fullCandidate.emailMessageId,
        }
      : null,
    documentFingerprint: input.documentFingerprint,
    legacyDuplicateKey: input.legacyDuplicateKey ?? null,
    scfcFingerprint: input.scfcFingerprint ?? null,
    forceReprocess: input.forceReprocess,
    identityStability: input.identityStability,
    amountRecoveredOnRescan: input.amountRecoveredOnRescan,
    duplicateSuspicionFailed: duplicateSuspicion.failed,
    duplicateSuspicionWarning: duplicateSuspicion.warning,
    sameEmailAttachmentMatch: input.sameEmailAttachmentMatch,
    crossChannelUnsure,
    invoiceNumber: input.invoiceNumber,
    currentSource: input.source,
  };
}

export async function recordFinancialDocumentDecision(input: FinancialDocumentInput) {
  const documentType = normalizeFinancialDocumentType(input.documentType);
  const totalAmount = input.totalAmount ?? null;
  const documentDate = parseDate(input.documentDate);
  const dueDate = parseDate(input.dueDate);
  const confidenceScore = clampConfidence(input.confidenceScore);
  const trustReason = trustGatesFailClosedReason(
    parseTrustGatesFromParsedFields(input.parsedFieldsJson ?? null)
  );
  const blockingReason =
    trustReason ??
    financialDocumentBlockingReason({
      supplierName: input.supplierName,
      invoiceNumber: input.invoiceNumber,
      totalAmount,
      documentDate,
      parsedFieldsJson: input.parsedFieldsJson,
    });
  const sourceFingerprint = buildFinancialDocumentFingerprint({
    source: input.source,
    sender: input.sender,
    fileName: input.fileName,
    fileSize: input.fileSize,
    amount: totalAmount,
    invoiceNumber: input.invoiceNumber,
    date: documentDate,
  });
  const legacyDocumentFingerprint = buildCrossSourceFinancialFingerprint({
    sender: input.supplierName ?? input.sender,
    amount: totalAmount,
    invoiceNumber: input.invoiceNumber,
    date: documentDate,
  });
  const canonical = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName ?? input.sender,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount,
    documentDate,
    documentType,
    fileSha256: input.fileSha256,
  });
  const legacyDuplicateHash = buildLegacyDuplicateHashForLookup({
    organizationId: input.organizationId,
    supplier: input.supplierName ?? input.sender ?? "unknown",
    amount: totalAmount ?? 0,
    dateIso: documentDate?.toISOString() ?? new Date().toISOString(),
    subject: input.subject,
  });
  logFingerprintShadowMode({
    organizationId: input.organizationId,
    source: input.source,
    canonical,
    legacyDuplicateHash,
  });
  const documentFingerprint = canonical.fingerprint ?? canonical.legacyFingerprint;

  if (!isPaymentDocumentType(documentType)) {
    await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, sourceFingerprint, documentFingerprint, reviewStatus: "rejected", uncertaintyReason: input.uncertaintyReason ?? "מסמך לא רלוונטי" });
    console.log(`[financial-document] filtered_irrelevant source=${input.source} fingerprint=${documentFingerprint} type=${documentType}`);
    return { action: "filtered" as const, documentType, sourceFingerprint, documentFingerprint };
  }

  if (blockingReason) {
    const review = await upsertReview({
      ...input,
      documentType,
      documentDate,
      dueDate,
      confidenceScore,
      parsedFieldsJson: input.parsedFieldsJson,
      sourceFingerprint,
      documentFingerprint,
      reviewStatus: "needs_review",
      uncertaintyReason: input.uncertaintyReason ?? blockingReason,
    });
    console.log(`[financial-document] needs_review source=${input.source} reviewId=${review.id} reason="${blockingReason}"`);
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  if (input.forceNeedsReview) {
    const review = await upsertReview({
      ...input,
      documentType,
      documentDate,
      dueDate,
      confidenceScore,
      parsedFieldsJson: input.parsedFieldsJson,
      sourceFingerprint,
      documentFingerprint,
      reviewStatus: "needs_review",
      uncertaintyReason: input.uncertaintyReason ?? "needs review requested by classifier",
    });
    console.log(`[financial-document] needs_review source=${input.source} reviewId=${review.id} reason="${input.uncertaintyReason ?? "forced_review"}"`);
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  const duplicateCandidateWhere = buildSupplierPaymentLookupClauses({
    canonicalFingerprint: documentFingerprint,
    legacySemanticFingerprint: canonical.legacyFingerprint,
    legacyCrossSourceFingerprint: legacyDocumentFingerprint,
    sourceFingerprint,
    legacyDuplicateHash,
    supplierName: input.supplierName,
    invoiceNumber: input.invoiceNumber,
    totalAmount,
    documentDate,
  });
  const duplicateCandidates = await prisma.supplierPayment.findMany({
    where: {
      organizationId: input.organizationId,
      OR: duplicateCandidateWhere,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const duplicateMatch = matchExistingFinancialDocumentCandidate({
    current: {
      organizationId: input.organizationId,
      supplierName: input.supplierName ?? input.sender,
      supplierTaxId: input.supplierTaxId,
      invoiceNumber: input.invoiceNumber,
      totalAmount,
      documentDate,
      documentType,
      fileSha256: input.fileSha256,
    },
    candidates: duplicateCandidates,
  });
  const matchedCandidateId = duplicateMatch.result === "MATCH" ? duplicateMatch.candidate?.id : null;
  const existingPayment = matchedCandidateId
    ? duplicateCandidates.find((candidate) => candidate.id === matchedCandidateId) ?? null
    : null;

  if (existingPayment) {
    const sources = mergeSources(existingPayment.sourcesJson, input.source);
    const trustGates = parseTrustGatesFromParsedFields(input.parsedFieldsJson);
    const canPromoteApproval = allTrustGatesPass(trustGates);
    const updated = await prisma.supplierPayment.update({
      where: { id: existingPayment.id },
      data: {
        source: sources.includes("gmail") && sources.includes("whatsapp") ? "both" : existingPayment.source,
        lastSource: input.source,
        sourceCount: sources.length,
        sourcesJson: sources,
        duplicateDetected: false,
        duplicateReason: null,
        supplier: input.supplierName ?? existingPayment.supplier,
        supplierName: input.supplierName ?? existingPayment.supplierName,
        invoiceNumber: input.invoiceNumber ?? existingPayment.invoiceNumber,
        amount: totalAmount ?? existingPayment.amount,
        date: documentDate ?? existingPayment.date,
        dueDate: dueDate ?? existingPayment.dueDate,
        supplierTaxId: input.supplierTaxId ?? existingPayment.supplierTaxId,
        documentTypeDetailed: documentType,
        amountBeforeVat: input.amountBeforeVat ?? existingPayment.amountBeforeVat,
        vatAmount: input.vatAmount ?? existingPayment.vatAmount,
        totalAmount: totalAmount ?? existingPayment.totalAmount,
        confidenceScore: Math.max(existingPayment.confidenceScore ?? 0, confidenceScore),
        parsedFieldsJson: input.parsedFieldsJson as any,
        approvalStatus: canPromoteApproval
          ? "approved"
          : existingPayment.approvalStatus === "approved"
            ? "needs_review"
            : existingPayment.approvalStatus ?? "needs_review",
        driveFileUrl: input.driveFileUrl ?? existingPayment.driveFileUrl,
        invoiceLink: isInvoiceLike(documentType) ? input.driveFileUrl ?? existingPayment.invoiceLink : existingPayment.invoiceLink,
        documentLink: input.driveFileUrl ?? existingPayment.documentLink,
        lastSeenAt: new Date(),
      },
    });
    await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, sourceFingerprint, documentFingerprint, reviewStatus: "duplicate", supplierPaymentId: updated.id, uncertaintyReason: "זוהתה כפילות - הרשומה הקיימת עודכנה" });
    console.log(`[financial-document] duplicate source=${input.source} paymentId=${updated.id} fingerprint=${documentFingerprint} reasons=${duplicateMatch.reasons.join(",")}`);
    return { action: "duplicate" as const, documentType, sourceFingerprint, documentFingerprint, payment: updated };
  }

  if (duplicateMatch.result === "UNSURE") {
    const review = await upsertReview({
      ...input,
      documentType,
      documentDate,
      dueDate,
      confidenceScore,
      parsedFieldsJson: input.parsedFieldsJson,
      sourceFingerprint,
      documentFingerprint,
      reviewStatus: "needs_review",
      supplierPaymentId: duplicateMatch.candidate?.id ?? null,
      uncertaintyReason: input.uncertaintyReason ?? `possible duplicate: ${duplicateMatch.reasons.join(", ")}`,
    });
    console.log(`[financial-document] possible_duplicate_review source=${input.source} reviewId=${review.id} candidatePaymentId=${duplicateMatch.candidate?.id ?? "none"} reasons=${duplicateMatch.reasons.join(",")}`);
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  if (confidenceScore < 0.8) {
    const review = await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, parsedFieldsJson: input.parsedFieldsJson, sourceFingerprint, documentFingerprint, reviewStatus: "needs_review", uncertaintyReason: input.uncertaintyReason ?? `confidence below 80% (${Math.round(confidenceScore * 100)}%)` });
    console.log(`[financial-document] needs_review source=${input.source} reviewId=${review.id} confidence=${confidenceScore}`);
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  return { action: "accepted" as const, documentType, sourceFingerprint, documentFingerprint };
}

export async function approveFinancialDocumentReview(organizationId: string, reviewId: string) {
  const review = await prisma.financialDocumentReview.findFirst({ where: { id: reviewId, organizationId } });
  if (!review) throw new Error("Document review item not found");
  const displayAmount = resolveDocumentReviewDisplayAmount({
    totalAmount: review.totalAmount,
    amountBeforeVat: review.amountBeforeVat,
    vatAmount: review.vatAmount,
    parsedFieldsJson: review.parsedFieldsJson,
    currency: review.currency,
  });
  const approvedAmount = review.totalAmount ?? displayAmount.amount;
  if (!isCanonicalFinanceAmountResolved(approvedAmount)) {
    throw new Error("Cannot approve document without a verified total amount");
  }
  if (!isPaymentDocumentType(normalizeFinancialDocumentType(review.documentType))) {
    return prisma.financialDocumentReview.update({ where: { id: review.id }, data: { reviewStatus: "rejected", uncertaintyReason: "מסמך לא רלוונטי" } });
  }
  const approvedSupplierName =
    parseSupplierGateFromParsedFields(review.parsedFieldsJson)?.canonicalSupplierName ??
    review.supplierName?.trim() ??
    null;
  if (!approvedSupplierName) {
    throw new Error("Cannot approve document without a verified supplier name");
  }
  if (!review.documentFingerprint?.trim()) {
    throw new Error("Cannot approve document without a verified document fingerprint");
  }
  const duplicateGateInput = await buildDuplicateGateInput({
    organizationId,
    source: review.source as FinancialDocumentSource,
    sender: review.sender,
    supplierName: review.supplierName,
    supplierTaxId: review.supplierTaxId,
    invoiceNumber: review.invoiceNumber,
    totalAmount: approvedAmount,
    documentDate: review.documentDate,
    documentType: review.documentType,
    documentFingerprint: review.documentFingerprint,
    legacyDuplicateHash: review.documentFingerprint,
    scfcFingerprint: review.documentFingerprint,
    parsedFieldsJson: review.parsedFieldsJson,
  });
  const trustEvaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: review.parsedFieldsJson,
    totalAmount: approvedAmount,
    supplierName: review.supplierName,
    fingerprintGateInput: buildFingerprintGateInputFromReview({
      organizationId,
      supplierName: review.supplierName,
      supplierTaxId: review.supplierTaxId,
      invoiceNumber: review.invoiceNumber,
      totalAmount: approvedAmount,
      documentDate: review.documentDate,
      documentType: review.documentType,
      documentFingerprint: review.documentFingerprint,
      parsedFieldsJson: review.parsedFieldsJson,
    }),
    duplicateGateInput,
  });
  const canOverrideSourceConflict =
    (trustEvaluation.reasonCode === "amount.source_conflict" ||
      trustEvaluation.blockReason === "amount.source_conflict") &&
    isCanonicalFinanceAmountResolved(displayAmount.amount) &&
    approvedAmount === displayAmount.amount;
  const effectiveEvaluation = canOverrideSourceConflict
    ? {
        ...trustEvaluation,
        outcome: "pass" as const,
        shouldCreatePayment: true,
        reasonCode: null,
        blockReason: null,
      }
    : trustEvaluation;
  if (effectiveEvaluation.outcome !== "pass" || !effectiveEvaluation.shouldCreatePayment) {
    const reason = trustEvaluation.blockReason ?? trustEvaluation.reasonCode ?? "trust gate blocked";
    throw new Error(`לא ניתן לאשר מסמך — בדיקת אמון נכשלה (${reason})`);
  }
  const createResult = await createSupplierPaymentIfTrusted({
    evaluation: effectiveEvaluation,
    data: {
      organizationId,
      supplier: approvedSupplierName,
      amount: approvedAmount,
      currency: review.currency,
      date: review.documentDate ?? new Date(),
      dueDate: review.dueDate,
      paid: review.documentType === "receipt" || review.documentType === "tax_invoice_receipt",
      documentLink: review.driveFileUrl,
      invoiceLink: isInvoiceLike(normalizeFinancialDocumentType(review.documentType)) ? review.driveFileUrl : null,
      driveUploadStatus: review.driveUploadStatus,
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
      totalAmount: approvedAmount,
      confidenceScore: review.confidenceScore,
      parsedFieldsJson: review.parsedFieldsJson as any,
      approvalStatus: "approved",
      sourcesJson: [review.source],
      emailMessageId: review.emailMessageId,
    },
    upsert: {
      where: { organizationId_documentFingerprint: { organizationId, documentFingerprint: review.documentFingerprint } },
      update: {
        approvalStatus: "approved",
        driveUploadStatus: review.driveUploadStatus,
        confidenceScore: review.confidenceScore,
        parsedFieldsJson: review.parsedFieldsJson as any,
        lastSeenAt: new Date(),
      },
    },
  });
  if (createResult.skipped || !createResult.payment) {
    throw new Error(`לא ניתן לאשר מסמך — יצירת תשלום נחסמה (${createResult.reason ?? "trust gate blocked"})`);
  }
  const payment = createResult.payment;
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
      parsedFieldsJson: input.parsedFieldsJson as any,
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
      parsedFieldsJson: input.parsedFieldsJson as any,
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

function isValidSupplierName(value?: string | null) {
  const supplier = value?.trim() ?? "";
  if (!supplier) return false;
  if (isLikelyJunkSupplierName(supplier)) return false;
  if (/^(unknown|unknown supplier|לא ידוע|לא מזוהה|n\/a|null|undefined)$/i.test(supplier)) return false;
  if (supplier === ".name" || supplier.startsWith(".")) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier)) return false;
  if (/^[\w.-]+\.[a-z]{2,}$/i.test(supplier)) return false;
  return supplier.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
}

