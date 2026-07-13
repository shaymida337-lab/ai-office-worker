import { createHash } from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  buildWeakDocumentFallbackFingerprint,
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
import { upsertFinanceGateSnapshot } from "./trust/financeGateSnapshots.js";
import type { MoneyDecision } from "./amount/canonicalAmount.js";
import {
  attachSupplierGateToParsedFields,
  evaluateSupplierGate,
  parseSupplierGateFromParsedFields,
  supplierGatePasses,
  type SirSummaryForSupplierGate,
  type SupplierGateSnapshot,
} from "./supplier/supplierGate.js";
import type { SupplierDecision } from "./supplier/supplierTypes.js";
import {
  attachFingerprintGateToParsedFields,
  buildFingerprintGateInputFromReview,
  evaluateFingerprintGate,
  fingerprintGatePasses,
  type FingerprintGateSnapshot,
} from "./dedup/fingerprintGate.js";
import type { FingerprintIdentityStability } from "./dedup/fingerprintGate.js";
import {
  attachDuplicateGateToParsedFields,
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
  evaluateFinanceTrustGates,
  evaluateFreshAmountGateForManualApproval,
  evaluateFreshTrustGatesForManualApproval,
} from "./trust/financeTrustPersistence.js";
import { isBlockedDocumentOutcome } from "./trust/blockedOutcomeGuard.js";
import {
  mergeReviewSupplierConfirmation,
  resolveReviewSupplierContext,
  resolveSupplierNameForApproval,
  normalizeSupplierPaymentKey,
} from "./reviewSupplierResolution.js";
import { isLikelyJunkSupplierName } from "./supplierNameValidation.js";
import {
  isCanonicalFinanceAmountResolved,
  resolveDocumentReviewDisplayAmount,
} from "./amount/financeDisplayAmount.js";
import {
  aiAuditContext,
  recordPlatformAudit,
  resolveWorkflowCorrelationId,
  reviewAuditSnapshot,
  userAuditContext,
} from "./auditLog/index.js";
import {
  completeCoreWorkflowStage,
  createCoreWorkflowTrace,
  emitCoreWorkflowAudit,
  emitCoreWorkflowFailure,
} from "./reliability/core/index.js";
import {
  resolveExtractedDocumentFinancial,
  textFromParsedFieldsJson,
} from "./classification/financialDocumentClassification.js";

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
  /** בעלות שאומתה בשאילתת id+organizationId — מתיר אישור camera תחת containment */
  verifiedTenantScope?: import("./p0/financialContainment.js").VerifiedTenantScope;
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
  const { assertFinancialIngestionAllowed } = await import("./p0/financialContainment.js");
  assertFinancialIngestionAllowed(input.organizationId, input.verifiedTenantScope);

  const workflowTrace = createCoreWorkflowTrace({
    subsystem: "review_queue",
    organizationId: input.organizationId,
    gmailMessageId: input.gmailMessageId,
    emailMessageId: input.emailMessageId,
    workflow: "review_queue",
  });
  emitCoreWorkflowAudit(workflowTrace, "started", "record_decision");

  try {
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
  // F7: כשאין זהות קנונית (טיר weak/none) — מפתח fallback ייחודי פר-מקור, כדי
  // שמסמכים שונים חסרי-זהות לא יידרסו זה את זה ב-upsert של רשומת הביקורת.
  const documentFingerprint =
    canonical.fingerprint ??
    buildWeakDocumentFallbackFingerprint({
      organizationId: input.organizationId,
      legacyFingerprint: canonical.legacyFingerprint,
      uniqueHint:
        input.gmailMessageId ??
        input.whatsappLogId ??
        input.emailMessageId ??
        input.fileName ??
        input.subject ??
        null,
    });

  if (
    !resolveExtractedDocumentFinancial({
      documentType: input.documentType,
      supplierName: input.supplierName,
      totalAmount,
      amount: totalAmount,
      invoiceNumber: input.invoiceNumber,
      filename: input.fileName,
      subject: input.subject,
      attachmentText: textFromParsedFieldsJson(input.parsedFieldsJson),
    })
  ) {
    const review = await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, sourceFingerprint, documentFingerprint, reviewStatus: "rejected", uncertaintyReason: input.uncertaintyReason ?? "מסמך לא רלוונטי" });
    recordPlatformAudit({
      ...aiAuditContext("financialDocuments", resolveWorkflowCorrelationId({ gmailMessageId: input.gmailMessageId, emailMessageId: input.emailMessageId })),
      organizationId: input.organizationId,
      entityType: "financial_document_review",
      entityId: review.id,
      action: "document_rejected",
      afterState: reviewAuditSnapshot(review),
      reason: input.uncertaintyReason ?? "מסמך לא רלוונטי",
    });
    console.log(`[financial-document] filtered_irrelevant source=${input.source} fingerprint=${documentFingerprint} type=${documentType}`);
    completeCoreWorkflowStage(workflowTrace, "record_decision", "skipped", {
      health: "Healthy",
      metadata: { action: "filtered" },
    });
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
    completeCoreWorkflowStage(workflowTrace, "record_decision", "completed", {
      health: "Degraded",
      metadata: { action: "needs_review", reviewId: review.id },
    });
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
    completeCoreWorkflowStage(workflowTrace, "record_decision", "completed", {
      health: "Degraded",
      metadata: { action: "needs_review", reviewId: review.id, forced: true },
    });
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
        supplier: input.supplierName
          ? normalizeSupplierPaymentKey(input.supplierName)
          : existingPayment.supplier,
        supplierName: input.supplierName
          ? normalizeSupplierPaymentKey(input.supplierName)
          : existingPayment.supplierName,
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
    completeCoreWorkflowStage(workflowTrace, "record_decision", "completed", {
      health: "Healthy",
      metadata: { action: "duplicate", paymentId: updated.id },
    });
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
    completeCoreWorkflowStage(workflowTrace, "record_decision", "completed", {
      health: "Degraded",
      metadata: { action: "needs_review", reviewId: review.id, possibleDuplicate: true },
    });
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  if (confidenceScore < 0.8) {
    const review = await upsertReview({ ...input, documentType, documentDate, dueDate, confidenceScore, parsedFieldsJson: input.parsedFieldsJson, sourceFingerprint, documentFingerprint, reviewStatus: "needs_review", uncertaintyReason: input.uncertaintyReason ?? `confidence below 80% (${Math.round(confidenceScore * 100)}%)` });
    console.log(`[financial-document] needs_review source=${input.source} reviewId=${review.id} confidence=${confidenceScore}`);
    completeCoreWorkflowStage(workflowTrace, "record_decision", "completed", {
      health: "Degraded",
      metadata: { action: "needs_review", reviewId: review.id, lowConfidence: true },
    });
    return { action: "needs_review" as const, documentType, sourceFingerprint, documentFingerprint, review };
  }

  completeCoreWorkflowStage(workflowTrace, "record_decision", "completed", {
    health: "Healthy",
    metadata: { action: "accepted" },
  });
  return { action: "accepted" as const, documentType, sourceFingerprint, documentFingerprint };
  } catch (error) {
    emitCoreWorkflowFailure(workflowTrace, "record_decision", error);
    throw error;
  }
}

/**
 * ביטחון של מסמך שהמשתמש הקליד/אישר ידנית (מצלמה): גבוה מסף ה-80%, אבל לא 1.0 —
 * ההחלטה האמיתית נופלת על שערי האמון, לא על המספר הזה.
 */
export const MANUAL_ENTRY_CONFIDENCE = 0.95;

/**
 * SIR סינתטי למסמך שהוזן ידנית: המשתמש הוא מקור הזהות של הספק, ולכן הרזולוציה
 * "resolved" — אבל היוריסטיקות איכות השם (placeholder/אימייל/טלפון/זבל OCR)
 * עדיין רצות במלואן בתוך evaluateSupplierGate ויפילו שם לא תקין ל-review.
 */
export function buildManualEntrySirSummary(supplierName: string): SirSummaryForSupplierGate {
  return {
    supplierName,
    canonicalSupplier: supplierName,
    status: "resolved",
    reasonCode: "MANUAL_USER_ENTRY",
    isStrongEnoughForAutoSave: true,
    winnerKind: null,
  };
}

export type ManualEntryFinancialDocumentInput = {
  organizationId: string;
  source: FinancialDocumentSource;
  /** בעלות שאומתה בשאילתת id+organizationId — מתיר אישור camera תחת containment */
  verifiedTenantScope?: import("./p0/financialContainment.js").VerifiedTenantScope;
  subject?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  supplierName: string;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  documentDate?: Date | null;
  dueDate?: Date | null;
  totalAmount: number;
  currency?: string | null;
  documentType: string;
  driveFileUrl?: string | null;
  driveUploadStatus?: string | null;
  fileSha256?: string | null;
  userId?: string | null;
  sourceRoute?: string | null;
};

/**
 * בונה parsedFieldsJson עם ארבעת שערי האמון האמיתיים (סכום/ספק/טביעת אצבע/כפילות)
 * עבור מסמך שהוזן ידנית — אותם שערים שהצינור של Gmail עובר, בלי להרפות אף סף.
 * מחליף את המצב הישן שבו המצלמה שלחה parsedFieldsJson ריק ונפלה תמיד על
 * trust.gates_missing בלי קשר לאיכות הנתונים.
 */
export async function buildManualEntryParsedFields(input: {
  organizationId: string;
  source: FinancialDocumentSource;
  supplierName: string;
  supplierTaxId?: string | null;
  invoiceNumber?: string | null;
  totalAmount: number;
  documentDate?: Date | null;
  documentType: string;
  fileSha256?: string | null;
  subject?: string | null;
}): Promise<{ parsedFieldsJson: Record<string, unknown>; documentFingerprint: string }> {
  const documentType = normalizeFinancialDocumentType(input.documentType);
  const sirSummary = buildManualEntrySirSummary(input.supplierName);
  const parsedFieldsJson: Record<string, unknown> = { sir: sirSummary };

  upsertFinanceGateSnapshot(
    parsedFieldsJson,
    evaluateFreshAmountGateForManualApproval({ totalAmount: input.totalAmount })
  );
  attachSupplierGateToParsedFields(parsedFieldsJson, {
    sirSummary,
    supplierName: input.supplierName,
  });
  attachFingerprintGateToParsedFields(
    parsedFieldsJson,
    buildFingerprintGateInputFromReview({
      organizationId: input.organizationId,
      supplierName: input.supplierName,
      supplierTaxId: input.supplierTaxId,
      invoiceNumber: input.invoiceNumber,
      totalAmount: input.totalAmount,
      documentDate: input.documentDate ?? null,
      documentType: input.documentType,
      fileSha256: input.fileSha256,
    })
  );

  const canonical = computeCanonicalFingerprint({
    organizationId: input.organizationId,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.totalAmount,
    documentDate: input.documentDate ?? null,
    documentType,
    fileSha256: input.fileSha256,
  });
  const documentFingerprint =
    canonical.fingerprint ??
    buildWeakDocumentFallbackFingerprint({
      organizationId: input.organizationId,
      legacyFingerprint: canonical.legacyFingerprint,
      uniqueHint: input.subject ?? input.supplierName,
    });
  const duplicateGateInput = await buildDuplicateGateInput({
    organizationId: input.organizationId,
    source: input.source,
    sender: null,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    totalAmount: input.totalAmount,
    documentDate: input.documentDate ?? null,
    documentType: input.documentType,
    fileSha256: input.fileSha256,
    documentFingerprint,
    legacyDuplicateHash: buildLegacyDuplicateHashForLookup({
      organizationId: input.organizationId,
      supplier: input.supplierName,
      amount: input.totalAmount,
      dateIso: (input.documentDate ?? new Date()).toISOString(),
      subject: input.subject,
    }),
    scfcFingerprint: canonical.legacyFingerprint,
    parsedFieldsJson,
  });
  attachDuplicateGateToParsedFields(parsedFieldsJson, duplicateGateInput);

  return { parsedFieldsJson, documentFingerprint };
}

/**
 * קליטת מסמך שהוזן ידנית (מצלמה) דרך אותה שרשרת החלטה של Gmail/WhatsApp:
 * שערי אמון אמיתיים → recordFinancialDocumentDecision (ולידציית שדות, כפילויות,
 * סף ביטחון) → ובמסלול accepted יצירת SupplierPayment מאושר, כמו שהערוצים
 * האחרים עושים אחרי accepted. מסמך לא-שלם/לא-ודאי ממשיך ל-review עם סיבה
 * ספציפית במקום trust.gates_missing גורף.
 */
export async function recordManualEntryFinancialDocument(input: ManualEntryFinancialDocumentInput) {
  const { parsedFieldsJson } = await buildManualEntryParsedFields(input);
  const baseDecisionInput: FinancialDocumentInput = {
    organizationId: input.organizationId,
    source: input.source,
    verifiedTenantScope: input.verifiedTenantScope,
    sender: null,
    subject: input.subject,
    fileName: input.fileName,
    fileSize: input.fileSize,
    supplierName: input.supplierName,
    supplierTaxId: input.supplierTaxId,
    invoiceNumber: input.invoiceNumber,
    documentDate: input.documentDate,
    dueDate: input.dueDate,
    totalAmount: input.totalAmount,
    documentType: input.documentType,
    driveFileUrl: input.driveFileUrl,
    confidenceScore: MANUAL_ENTRY_CONFIDENCE,
    uncertaintyReason: null,
    parsedFieldsJson,
    fileSha256: input.fileSha256,
  };
  const decision = await recordFinancialDocumentDecision(baseDecisionInput);

  if (decision.action !== "accepted") {
    return { ...decision, parsedFieldsJson };
  }

  // accepted לא שומר כלום בתוך recordFinancialDocumentDecision — הקורא יוצר את
  // התשלום (כמו Gmail/WhatsApp). כל השערים עברו והמשתמש אישר את הפרטים בעצמו.
  const normalizedType = decision.documentType;
  const correlationId = resolveWorkflowCorrelationId({});
  const auditCtx = input.userId
    ? userAuditContext(input.userId, "financialDocuments", input.sourceRoute ?? undefined, correlationId)
    : aiAuditContext("financialDocuments", correlationId);
  const createResult = await createSupplierPaymentIfTrusted({
    evaluation: evaluateFinanceTrustGates({
      parsedFieldsJson,
      selectedAmount: input.totalAmount,
      needsReview: false,
      confidenceScore: MANUAL_ENTRY_CONFIDENCE,
      documentType: input.documentType,
    }),
    audit: auditCtx,
    parsedFieldsJson,
    data: {
      organizationId: input.organizationId,
      supplier: input.supplierName,
      amount: input.totalAmount,
      currency: input.currency ?? "ILS",
      date: input.documentDate ?? new Date(),
      dueDate: input.dueDate ?? null,
      paid: normalizedType === "receipt" || normalizedType === "tax_invoice_receipt",
      documentLink: input.driveFileUrl ?? null,
      invoiceLink: isInvoiceLike(normalizedType) ? input.driveFileUrl ?? null : null,
      driveUploadStatus: input.driveUploadStatus ?? null,
      emailSender: null,
      paymentRequired: normalizedType !== "receipt",
      missingInvoice: normalizedType === "payment_request",
      duplicateHash: decision.documentFingerprint,
      subject: input.subject ?? null,
      source: input.source,
      firstSource: input.source,
      lastSource: input.source,
      sourceCount: 1,
      documentFingerprint: decision.documentFingerprint,
      sourceFingerprint: decision.sourceFingerprint,
      documentTypeDetailed: input.documentType,
      supplierTaxId: input.supplierTaxId ?? null,
      totalAmount: input.totalAmount,
      confidenceScore: MANUAL_ENTRY_CONFIDENCE,
      parsedFieldsJson: parsedFieldsJson as never,
      approvalStatus: "approved",
      sourcesJson: [input.source],
    },
    upsert: {
      where: {
        organizationId_documentFingerprint: {
          organizationId: input.organizationId,
          documentFingerprint: decision.documentFingerprint,
        },
      },
      update: {
        approvalStatus: "approved",
        confidenceScore: MANUAL_ENTRY_CONFIDENCE,
        parsedFieldsJson: parsedFieldsJson as never,
        lastSeenAt: new Date(),
      },
    },
  });

  if (createResult.skipped || !createResult.payment) {
    // fail-safe: אם יצירת התשלום נחסמה בכל זאת, המסמך לא נעלם — נופל ל-review
    // עם הסיבה האמיתית של החסימה.
    const fallback = await recordFinancialDocumentDecision({
      ...baseDecisionInput,
      forceNeedsReview: true,
      uncertaintyReason: createResult.reason ?? "trust gate blocked",
    });
    return { ...fallback, parsedFieldsJson };
  }

  console.log(
    `[financial-document] manual_entry_accepted source=${input.source} paymentId=${createResult.payment.id} fingerprint=${decision.documentFingerprint}`
  );
  return {
    action: "accepted" as const,
    documentType: decision.documentType,
    sourceFingerprint: decision.sourceFingerprint,
    documentFingerprint: decision.documentFingerprint,
    payment: createResult.payment,
    parsedFieldsJson,
  };
}

export type FinancialDocumentApprovalTarget = "invoices" | "payments";

export type ApproveFinancialDocumentReviewResult = {
  review: NonNullable<Awaited<ReturnType<typeof prisma.financialDocumentReview.findFirst>>>;
  paymentId: string;
  targetScreen: FinancialDocumentApprovalTarget;
};

function resolveApprovalTargetScreen(documentType: string): FinancialDocumentApprovalTarget {
  const normalized = normalizeFinancialDocumentType(documentType);
  if (normalized === "receipt" || normalized === "tax_invoice" || normalized === "tax_invoice_receipt") {
    return "invoices";
  }
  return "payments";
}

function resolveReviewNormalizedDocumentDate(review: { documentDate: Date | null; createdAt: Date }): Date {
  const date = review.documentDate ?? review.createdAt;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
}

export type ReviewRecommendedAction = "approve" | "edit_supplier" | "complete_details" | "reject";

export type ReviewApprovalReadiness = {
  canApprove: boolean;
  blockReason: string | null;
  supplierNeedsConfirmation: boolean;
  recommendedAction: ReviewRecommendedAction;
  /** כשהחסימה היא כפילות — מזהה התשלום הקיים שמולו זוהתה ההתאמה */
  matchedDuplicatePaymentId?: string | null;
};

export type ReviewRowForReadiness = {
  organizationId: string;
  reviewStatus: string;
  source: string;
  documentType: string;
  totalAmount: number | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  currency: string;
  parsedFieldsJson: unknown;
  rawAnalysis?: unknown;
  supplierName: string | null;
  sender: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  documentDate: Date | null;
  documentFingerprint: string | null;
  uncertaintyReason: string | null;
};

/**
 * הרצה יבשה (ללא כתיבות) של בדיוק אותן ולידציות ש-approveFinancialDocumentReview
 * מריץ, באותו סדר ועם אותם primitives. זה חוזה ה-readiness של ה-UI: אם כאן
 * canApprove=true — קריאת האישור על אותם נתונים תעבור; אם היא תיכשל — הסיבה
 * נחשפת כאן לפני שהמשתמש לוחץ. כל שינוי בוולידציות של האישור חייב להשתקף כאן
 * (טסט ה-parity שומר על זה).
 */
export async function evaluateReviewApprovalReadiness(
  review: ReviewRowForReadiness
): Promise<ReviewApprovalReadiness> {
  const status = review.reviewStatus?.toLowerCase() ?? "";
  if (status !== "needs_review") {
    // approved/auto_saved/rejected/duplicate — אין פעולה זמינה; ה-UI מציג לפי הסטטוס
    return { canApprove: false, blockReason: null, supplierNeedsConfirmation: false, recommendedAction: "approve" };
  }

  // מראה לענף ה-rejected של האישור (מסמך לא רלוונטי) — שם זה מבוצע עם side effect
  if (!isPaymentDocumentType(normalizeFinancialDocumentType(review.documentType))) {
    return { canApprove: false, blockReason: "מסמך לא רלוונטי", supplierNeedsConfirmation: false, recommendedAction: "reject" };
  }

  // מראה לבדיקת הסכום של האישור
  const displayAmount = resolveDocumentReviewDisplayAmount({
    totalAmount: review.totalAmount,
    amountBeforeVat: review.amountBeforeVat,
    vatAmount: review.vatAmount,
    parsedFieldsJson: review.parsedFieldsJson,
    currency: review.currency,
  });
  const approvedAmount = review.totalAmount ?? displayAmount.amount;
  if (!isCanonicalFinanceAmountResolved(approvedAmount)) {
    return {
      canApprove: false,
      blockReason: FINANCE_AMOUNT_UNRESOLVED_REASON,
      supplierNeedsConfirmation: false,
      recommendedAction: "complete_details",
    };
  }

  // מראה ל-resolveSupplierNameForApproval — אותה פונקציה בדיוק, נתפסת במקום לזרוק
  const supplierReviewInput = {
    supplierName: review.supplierName,
    sender: review.sender,
    supplierTaxId: review.supplierTaxId,
    parsedFieldsJson: review.parsedFieldsJson,
    rawAnalysis: review.rawAnalysis,
  };
  let approvedSupplierName: string;
  try {
    approvedSupplierName = resolveSupplierNameForApproval(supplierReviewInput);
  } catch {
    return {
      canApprove: false,
      blockReason: "supplier.needs_confirmation",
      supplierNeedsConfirmation: true,
      recommendedAction: "edit_supplier",
    };
  }

  if (!review.documentFingerprint?.trim()) {
    return {
      canApprove: false,
      blockReason: "fingerprint.missing",
      supplierNeedsConfirmation: false,
      recommendedAction: "complete_details",
    };
  }
  if (isBlockedDocumentOutcome(review.parsedFieldsJson, review.uncertaintyReason)) {
    return { canApprove: false, blockReason: "blocked_outcome", supplierNeedsConfirmation: false, recommendedAction: "reject" };
  }

  // מראה להערכת שערי האמון של האישור — אותה טרנספורמציית parsedFields על עותק
  let parsedFieldsForApproval =
    review.parsedFieldsJson && typeof review.parsedFieldsJson === "object" && !Array.isArray(review.parsedFieldsJson)
      ? { ...(review.parsedFieldsJson as Record<string, unknown>) }
      : {};
  parsedFieldsForApproval = mergeReviewSupplierConfirmation(parsedFieldsForApproval, {
    rawExtractedName: review.supplierName,
    confirmedName: approvedSupplierName,
    userId: null,
  });
  attachSupplierGateToParsedFields(parsedFieldsForApproval, {
    sirSummary: {
      supplierName: approvedSupplierName,
      canonicalSupplier: approvedSupplierName,
      status: "resolved",
      isStrongEnoughForAutoSave: true,
    },
    supplierName: approvedSupplierName,
  });
  const duplicateGateInput = await buildDuplicateGateInput({
    organizationId: review.organizationId,
    source: review.source as FinancialDocumentSource,
    sender: review.sender,
    supplierName: approvedSupplierName,
    supplierTaxId: review.supplierTaxId,
    invoiceNumber: review.invoiceNumber,
    totalAmount: approvedAmount,
    documentDate: review.documentDate,
    documentType: review.documentType,
    documentFingerprint: review.documentFingerprint,
    legacyDuplicateHash: review.documentFingerprint,
    scfcFingerprint: review.documentFingerprint,
    parsedFieldsJson: { ...parsedFieldsForApproval },
  });
  const trustEvaluation = evaluateFreshTrustGatesForManualApproval({
    parsedFieldsJson: parsedFieldsForApproval,
    totalAmount: approvedAmount,
    supplierName: approvedSupplierName,
    fingerprintGateInput: buildFingerprintGateInputFromReview({
      organizationId: review.organizationId,
      supplierName: approvedSupplierName,
      supplierTaxId: review.supplierTaxId,
      invoiceNumber: review.invoiceNumber,
      totalAmount: approvedAmount,
      documentDate: review.documentDate,
      documentType: review.documentType,
      documentFingerprint: review.documentFingerprint,
      parsedFieldsJson: parsedFieldsForApproval,
    }),
    duplicateGateInput,
  });
  const canOverrideSourceConflict =
    (trustEvaluation.reasonCode === "amount.source_conflict" ||
      trustEvaluation.blockReason === "amount.source_conflict") &&
    isCanonicalFinanceAmountResolved(displayAmount.amount) &&
    approvedAmount === displayAmount.amount;
  if (!canOverrideSourceConflict && (trustEvaluation.outcome !== "pass" || !trustEvaluation.shouldCreatePayment)) {
    const blockReason = trustEvaluation.blockReason ?? trustEvaluation.reasonCode ?? "trust gate blocked";
    return {
      canApprove: false,
      blockReason,
      supplierNeedsConfirmation: false,
      recommendedAction: "complete_details",
      matchedDuplicatePaymentId: blockReason.startsWith("duplicate.")
        ? duplicateGateInput.matchedCandidate?.id ?? null
        : null,
    };
  }

  return { canApprove: true, blockReason: null, supplierNeedsConfirmation: false, recommendedAction: "approve" };
}

export type ReviewServerPrimaryAction = "approve" | "complete_details" | "edit_supplier" | "blocked_duplicate";

export type ReviewDecision = {
  canApprove: boolean;
  primaryAction: ReviewServerPrimaryAction;
  blockReason: string | null;
  displaySupplierName: string;
  confirmedSupplierName: string | null;
  supplierNeedsConfirmation: boolean;
  duplicate: {
    matchedPaymentId: string;
    supplier: string | null;
    amount: number | null;
    date: string | null;
    paid: boolean | null;
  } | null;
};

/**
 * אובייקט ההחלטה היחיד שה-frontend מרנדר ממנו — מקור אמת אחד: אותן ולידציות
 * של האישור, שם התצוגה שהוא גם שם האישור (אחרי ניקוי מפתחות פנימיים), ובחסימת
 * כפילות — פרטי הרשומה הקיימת שמולה זוהתה ההתאמה.
 */
export async function buildReviewDecision(
  review: ReviewRowForReadiness & { id?: string }
): Promise<ReviewDecision> {
  const supplierContext = resolveReviewSupplierContext({
    supplierName: review.supplierName,
    sender: review.sender,
    supplierTaxId: review.supplierTaxId,
    parsedFieldsJson: review.parsedFieldsJson,
    rawAnalysis: review.rawAnalysis,
  });
  const displaySupplierName =
    supplierContext.displaySupplierName ?? review.supplierName?.trim() ?? "";

  if (review.reviewStatus?.toLowerCase() !== "needs_review") {
    return {
      canApprove: false,
      primaryAction: "approve",
      blockReason: null,
      displaySupplierName,
      confirmedSupplierName: supplierContext.confirmedSupplierName,
      supplierNeedsConfirmation: false,
      duplicate: null,
    };
  }

  const readiness = await evaluateReviewApprovalReadiness(review);
  const isDuplicateBlock = Boolean(readiness.blockReason?.startsWith("duplicate."));

  let duplicate: ReviewDecision["duplicate"] = null;
  if (isDuplicateBlock && readiness.matchedDuplicatePaymentId) {
    const matched = await prisma.supplierPayment.findFirst({
      where: { id: readiness.matchedDuplicatePaymentId, organizationId: review.organizationId },
      select: { id: true, supplier: true, totalAmount: true, amount: true, date: true, paid: true },
    });
    if (matched) {
      duplicate = {
        matchedPaymentId: matched.id,
        supplier: matched.supplier,
        amount: matched.totalAmount ?? matched.amount,
        date: matched.date ? matched.date.toISOString() : null,
        paid: matched.paid,
      };
    } else {
      duplicate = { matchedPaymentId: readiness.matchedDuplicatePaymentId, supplier: null, amount: null, date: null, paid: null };
    }
  }

  const primaryAction: ReviewServerPrimaryAction = isDuplicateBlock
    ? "blocked_duplicate"
    : readiness.recommendedAction === "edit_supplier"
      ? "edit_supplier"
      : readiness.recommendedAction === "approve" && readiness.canApprove
        ? "approve"
        : "complete_details";

  return {
    canApprove: readiness.canApprove,
    primaryAction,
    blockReason: readiness.blockReason,
    displaySupplierName,
    confirmedSupplierName: supplierContext.confirmedSupplierName,
    supplierNeedsConfirmation: readiness.supplierNeedsConfirmation || supplierContext.supplierNeedsConfirmation,
    duplicate,
  };
}

export async function approveFinancialDocumentReview(
  organizationId: string,
  reviewId: string,
  options?: { userId?: string; sourceRoute?: string; confirmedSupplierName?: string },
): Promise<ApproveFinancialDocumentReviewResult> {
  try {
  let review = await prisma.financialDocumentReview.findFirst({ where: { id: reviewId, organizationId } });
  if (!review) throw new Error("Document review item not found");
  if (review.reviewStatus === "approved") {
    if (!review.supplierPaymentId) {
      throw new Error("המסמך מסומן מאושר אך ללא תשלום מקושר — לא ניתן להשלים את האישור");
    }
    const existingPayment = await prisma.supplierPayment.findFirst({
      where: { id: review.supplierPaymentId, organizationId, approvalStatus: "approved" },
      select: { id: true },
    });
    if (!existingPayment) {
      throw new Error("המסמך מסומן מאושר אך התשלום המקושר לא נמצא — לא ניתן להשלים את האישור");
    }
    return {
      review,
      paymentId: review.supplierPaymentId,
      targetScreen: resolveApprovalTargetScreen(review.documentType),
    };
  }
  const workflowTrace = createCoreWorkflowTrace({
    subsystem: "review_queue",
    organizationId,
    entityId: review.id,
    gmailMessageId: review.gmailMessageId,
    emailMessageId: review.emailMessageId,
    workflow: "review_approval",
  });
  emitCoreWorkflowAudit(workflowTrace, "started", "approve_review");
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
    const rejected = await prisma.financialDocumentReview.update({ where: { id: review.id }, data: { reviewStatus: "rejected", uncertaintyReason: "מסמך לא רלוונטי" } });
    const auditCtx = options?.userId
      ? userAuditContext(options.userId, "financialDocuments", options.sourceRoute, resolveWorkflowCorrelationId({ gmailMessageId: review.gmailMessageId, emailMessageId: review.emailMessageId }))
      : aiAuditContext("financialDocuments", resolveWorkflowCorrelationId({ gmailMessageId: review.gmailMessageId, emailMessageId: review.emailMessageId }));
    recordPlatformAudit({
      ...auditCtx,
      organizationId,
      entityType: "financial_document_review",
      entityId: rejected.id,
      action: "document_rejected",
      beforeState: reviewAuditSnapshot(review),
      afterState: reviewAuditSnapshot(rejected),
      reason: "מסמך לא רלוונטי",
    });
    throw new Error("מסמך לא רלוונטי");
  }
  const supplierReviewInput = {
    supplierName: review.supplierName,
    sender: review.sender,
    supplierTaxId: review.supplierTaxId,
    parsedFieldsJson: review.parsedFieldsJson,
    rawAnalysis: review.rawAnalysis,
  };
  const approvedSupplierName = resolveSupplierNameForApproval(
    supplierReviewInput,
    options?.confirmedSupplierName,
  );
  const rawExtractedSupplier = review.supplierName;
  let parsedFieldsForApproval =
    review.parsedFieldsJson && typeof review.parsedFieldsJson === "object" && !Array.isArray(review.parsedFieldsJson)
      ? { ...(review.parsedFieldsJson as Record<string, unknown>) }
      : {};
  parsedFieldsForApproval = mergeReviewSupplierConfirmation(parsedFieldsForApproval, {
    rawExtractedName: rawExtractedSupplier,
    confirmedName: approvedSupplierName,
    userId: options?.userId ?? null,
  });
  attachSupplierGateToParsedFields(parsedFieldsForApproval, {
    sirSummary: {
      supplierName: approvedSupplierName,
      canonicalSupplier: approvedSupplierName,
      status: "resolved",
      isStrongEnoughForAutoSave: true,
    },
    supplierName: approvedSupplierName,
  });
  review = {
    ...review,
    supplierName: approvedSupplierName,
    parsedFieldsJson: parsedFieldsForApproval as typeof review.parsedFieldsJson,
  };
  if (!approvedSupplierName) {
    throw new Error("Cannot approve document without a verified supplier name");
  }
  if (!review.documentFingerprint?.trim()) {
    throw new Error("Cannot approve document without a verified document fingerprint");
  }
  if (isBlockedDocumentOutcome(review.parsedFieldsJson, review.uncertaintyReason)) {
    throw new Error("לא ניתן לאשר מסמך — תוצאת עיבוד חסומה (BLOCKED)");
  }
  const duplicateGateInput = await buildDuplicateGateInput({
    organizationId,
    source: review.source as FinancialDocumentSource,
    sender: review.sender,
    supplierName: approvedSupplierName,
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
    parsedFieldsJson: parsedFieldsForApproval,
    totalAmount: approvedAmount,
    supplierName: approvedSupplierName,
    fingerprintGateInput: buildFingerprintGateInputFromReview({
      organizationId,
      supplierName: approvedSupplierName,
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
  const normalizedDocumentDate = resolveReviewNormalizedDocumentDate(review);
  const approvalTraceId = workflowTrace.correlationId;
  console.log(
    `[review-approval] traceId=${approvalTraceId} reviewId=${review.id} org=${organizationId} phase=transaction_start`,
  );
  const { payment, approved } = await prisma.$transaction(async (tx) => {
    const createResult = await createSupplierPaymentIfTrusted({
      evaluation: effectiveEvaluation,
      db: tx,
      audit: options?.userId
        ? userAuditContext(
            options.userId,
            "financialDocuments",
            options.sourceRoute,
            resolveWorkflowCorrelationId({ gmailMessageId: review.gmailMessageId, emailMessageId: review.emailMessageId }),
          )
        : aiAuditContext(
            "financialDocuments",
            resolveWorkflowCorrelationId({ gmailMessageId: review.gmailMessageId, emailMessageId: review.emailMessageId }),
          ),
      data: {
        organizationId,
        supplier: approvedSupplierName,
        supplierName: approvedSupplierName,
        amount: approvedAmount,
        currency: review.currency,
        date: review.documentDate ?? new Date(),
        normalizedDocumentDate,
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
        parsedFieldsJson: parsedFieldsForApproval as any,
        approvalStatus: "approved",
        sourcesJson: [review.source],
        emailMessageId: review.emailMessageId,
      },
      upsert: {
        where: { organizationId_documentFingerprint: { organizationId, documentFingerprint: review.documentFingerprint } },
        update: {
          approvalStatus: "approved",
          supplier: approvedSupplierName,
          supplierName: approvedSupplierName,
          amount: approvedAmount,
          totalAmount: approvedAmount,
          normalizedDocumentDate,
          driveUploadStatus: review.driveUploadStatus,
          documentLink: review.driveFileUrl,
          confidenceScore: review.confidenceScore,
          parsedFieldsJson: parsedFieldsForApproval as any,
          lastSeenAt: new Date(),
        },
      },
    });
    if (createResult.skipped || !createResult.payment) {
      throw new Error(`לא ניתן לאשר מסמך — יצירת תשלום נחסמה (${createResult.reason ?? "trust gate blocked"})`);
    }
    const linkedReview = await tx.financialDocumentReview.update({
      where: { id: review.id },
      data: {
        reviewStatus: "approved",
        supplierPaymentId: createResult.payment.id,
        supplierName: approvedSupplierName,
        normalizedDocumentDate,
        parsedFieldsJson: parsedFieldsForApproval as any,
      },
    });
    return { payment: createResult.payment, approved: linkedReview };
  });
  const verifiedPayment = await prisma.supplierPayment.findFirst({
    where: { id: payment.id, organizationId, approvalStatus: "approved" },
    select: { id: true },
  });
  if (!verifiedPayment) {
    throw new Error("אישור המסמך נכשל — התשלום לא נשמר במערכת");
  }
  console.log(
    `[review-approval] traceId=${approvalTraceId} reviewId=${review.id} org=${organizationId} paymentId=${payment.id} phase=completed`,
  );
  const correlationId = resolveWorkflowCorrelationId({ gmailMessageId: review.gmailMessageId, emailMessageId: review.emailMessageId });
  const auditCtx = options?.userId
    ? userAuditContext(options.userId, "financialDocuments", options.sourceRoute, correlationId)
    : aiAuditContext("financialDocuments", correlationId);
  recordPlatformAudit({
    ...auditCtx,
    organizationId,
    entityType: "financial_document_review",
    entityId: approved.id,
    action: "document_approved",
    beforeState: reviewAuditSnapshot(review),
    afterState: reviewAuditSnapshot(approved),
    metadata: { supplierPaymentId: payment.id },
  });
  if (canOverrideSourceConflict) {
    recordPlatformAudit({
      ...auditCtx,
      organizationId,
      entityType: "financial_document_review",
      entityId: approved.id,
      action: "review_overridden",
      beforeState: reviewAuditSnapshot(review),
      afterState: reviewAuditSnapshot(approved),
      reason: "amount.source_conflict",
      metadata: { supplierPaymentId: payment.id },
    });
  }
  completeCoreWorkflowStage(workflowTrace, "approve_review", "completed", {
    health: "Healthy",
    metadata: { reviewId: approved.id, paymentId: payment.id },
  });
  return {
    review: approved,
    paymentId: payment.id,
    targetScreen: resolveApprovalTargetScreen(approved.documentType),
  };
  } catch (error) {
    const failureTrace = createCoreWorkflowTrace({
      subsystem: "review_queue",
      organizationId,
      entityId: reviewId,
      workflow: "review_approval",
    });
    emitCoreWorkflowFailure(failureTrace, "approve_review", error, { userFacing: true });
    void import("./reliability/center/reliabilitySelfHealing.js")
      .then(({ noteDocumentApprovalFailure }) =>
        noteDocumentApprovalFailure({
          organizationId,
          userId: options?.userId ?? null,
          reviewId,
          correlationId: failureTrace.correlationId,
          message: error instanceof Error ? error.message : String(error),
        })
      )
      .catch((err) => {
        console.warn(
          "[reliability] failed to persist document approval reliability event",
          err instanceof Error ? err.message : String(err)
        );
      });
    throw error;
  }
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

