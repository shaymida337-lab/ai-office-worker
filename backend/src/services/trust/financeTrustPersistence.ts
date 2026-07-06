import type { Prisma, SupplierPayment } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";
import {
  recordPlatformAudit,
  paymentAuditSnapshot,
  aiAuditContext,
  resolveWorkflowCorrelationId,
  type PlatformAuditActorContext,
} from "../auditLog/index.js";
import {
  completeCoreWorkflowStage,
  createCoreWorkflowTrace,
  emitCoreWorkflowAudit,
  emitCoreWorkflowFailure,
  resolveCoreWorkflowCorrelationId,
} from "../reliability/core/index.js";
import {
  evaluateAmountGate,
  FINANCE_AMOUNT_UNRESOLVED_REASON,
  type AmountGateSnapshot,
  type FseSummaryForAmountGate,
} from "../amount/amountGate.js";
import { ARC_VERSION } from "../amount/canonicalAmount.js";
import {
  duplicateSupplierPaymentBlockReason,
  findActiveSupplierPaymentForSource,
} from "../dedup/supplierPaymentSourceDedup.js";
import {
  BLOCKED_OUTCOME_PERSISTENCE_REASON,
  isBlockedDocumentOutcome,
} from "./blockedOutcomeGuard.js";
import { assertNewSupplierPaymentQuality } from "../p0/supplierPaymentQuality.js";
import {
  evaluateDuplicateGate,
  type DuplicateGateInput,
  type DuplicateGateSnapshot,
} from "../dedup/duplicateGate.js";
import {
  evaluateFingerprintGate,
  type FingerprintGateInput,
  type FingerprintGateSnapshot,
} from "../dedup/fingerprintGate.js";
import {
  evaluateSupplierGate,
  sirSummaryFromParsedFields,
  type SupplierGateSnapshot,
} from "../supplier/supplierGate.js";
import {
  allTrustGatesPass,
  amountGateAllowsManualApproval,
  buildMoneyDecisionForReview,
  parseFseSummaryFromParsedFields,
  parseTrustGatesFromParsedFields,
  supplierPaymentPersistenceDecision,
  TRUST_AMOUNT_GATE_MISSING,
  TRUST_DUPLICATE_GATE_MISSING,
  TRUST_FINGERPRINT_GATE_MISSING,
  TRUST_SUPPLIER_GATE_MISSING,
  type TrustGateSet,
} from "./trustGatePersistence.js";

export const FINANCE_TRUST_CONFIDENCE_THRESHOLD = 0.8;

function isFinancePaymentDocumentType(documentType: string | null | undefined): boolean {
  const normalized = (documentType ?? "").toLowerCase();
  if (/quote|proposal|estimate|הצעת\s*מחיר/.test(normalized)) return false;
  if (/tax_invoice_receipt|invoice_receipt|חשבונית\s*מס\s*קבלה/.test(normalized)) return true;
  if (/payment_request|payment request|דרישת|בקשת/.test(normalized)) return true;
  if (/receipt|קבלה/.test(normalized)) return true;
  if (/invoice|tax_invoice|חשבונית/.test(normalized)) return true;
  return false;
}

export type FinanceTrustOutcome = "pass" | "review" | "block";

export type FinanceTrustEvaluation = {
  outcome: FinanceTrustOutcome;
  reasonCode: string | null;
  gates: TrustGateSet;
  paymentAmount: number | null;
  approvalStatus: "approved" | "needs_review";
  shouldCreatePayment: boolean;
  shouldAppendToSheet: boolean;
  blockReason: string | null;
};

export type CreateSupplierPaymentIfTrustedResult = {
  payment: SupplierPayment | null;
  skipped: boolean;
  reason: string | null;
  evaluation: FinanceTrustEvaluation;
};

type GateLike = { verdict: string; reasonCode: string } | null;

function gateFailure(
  gate: GateLike,
  missingReason: string
): { outcome: FinanceTrustOutcome; reasonCode: string } | null {
  if (!gate) {
    return { outcome: "review", reasonCode: missingReason };
  }
  if (gate.verdict === "pass") return null;
  if (gate.verdict === "block") {
    return { outcome: "block", reasonCode: gate.reasonCode };
  }
  return { outcome: "review", reasonCode: gate.reasonCode };
}

function resolveTrustGates(input: {
  parsedFieldsJson?: unknown;
  amountGate?: AmountGateSnapshot | null;
  supplierGate?: SupplierGateSnapshot | null;
  fingerprintGate?: FingerprintGateSnapshot | null;
  duplicateGate?: DuplicateGateSnapshot | null;
}): TrustGateSet {
  const parsed = input.parsedFieldsJson !== undefined ? parseTrustGatesFromParsedFields(input.parsedFieldsJson) : null;
  return {
    amountGate: input.amountGate ?? parsed?.amountGate ?? null,
    supplierGate: input.supplierGate ?? parsed?.supplierGate ?? null,
    fingerprintGate: input.fingerprintGate ?? parsed?.fingerprintGate ?? null,
    duplicateGate: input.duplicateGate ?? parsed?.duplicateGate ?? null,
  };
}

function firstGateFailure(gates: TrustGateSet): { outcome: FinanceTrustOutcome; reasonCode: string } | null {
  return (
    gateFailure(gates.amountGate, TRUST_AMOUNT_GATE_MISSING) ??
    gateFailure(gates.supplierGate, TRUST_SUPPLIER_GATE_MISSING) ??
    gateFailure(gates.fingerprintGate, TRUST_FINGERPRINT_GATE_MISSING) ??
    gateFailure(gates.duplicateGate, TRUST_DUPLICATE_GATE_MISSING)
  );
}

export function requireAllFinanceGatesPass(gates: TrustGateSet): boolean {
  return allTrustGatesPass(gates);
}

export function evaluateFinanceTrustGates(input: {
  parsedFieldsJson?: unknown;
  uncertaintyReason?: string | null;
  amountGate?: AmountGateSnapshot | null;
  supplierGate?: SupplierGateSnapshot | null;
  fingerprintGate?: FingerprintGateSnapshot | null;
  duplicateGate?: DuplicateGateSnapshot | null;
  selectedAmount?: number | null;
  needsReview?: boolean;
  confidenceScore?: number | null;
  documentType?: string | null;
}): FinanceTrustEvaluation {
  const gates = resolveTrustGates(input);
  const gateFailureResult = firstGateFailure(gates);
  const persistence = supplierPaymentPersistenceDecision({
    selectedAmount: input.selectedAmount,
    needsReview: input.needsReview ?? false,
    ...gates,
  });

  if (isBlockedDocumentOutcome(input.parsedFieldsJson, input.uncertaintyReason)) {
    return {
      outcome: "block",
      reasonCode: BLOCKED_OUTCOME_PERSISTENCE_REASON,
      gates,
      paymentAmount: persistence.paymentAmount,
      approvalStatus: persistence.approvalStatus,
      shouldCreatePayment: false,
      shouldAppendToSheet: false,
      blockReason: BLOCKED_OUTCOME_PERSISTENCE_REASON,
    };
  }

  if (gateFailureResult) {
    return {
      outcome: gateFailureResult.outcome,
      reasonCode: gateFailureResult.reasonCode,
      gates,
      paymentAmount: persistence.paymentAmount,
      approvalStatus: persistence.approvalStatus,
      shouldCreatePayment: false,
      shouldAppendToSheet: false,
      blockReason: gateFailureResult.reasonCode,
    };
  }

  if (input.documentType != null) {
    if (!isFinancePaymentDocumentType(input.documentType)) {
      return {
        outcome: "review",
        reasonCode: "מסמך לא רלוונטי",
        gates,
        paymentAmount: persistence.paymentAmount,
        approvalStatus: persistence.approvalStatus,
        shouldCreatePayment: false,
        shouldAppendToSheet: false,
        blockReason: "מסמך לא רלוונטי",
      };
    }
  }

  if (
    input.confidenceScore != null &&
    Number.isFinite(input.confidenceScore) &&
    input.confidenceScore < FINANCE_TRUST_CONFIDENCE_THRESHOLD
  ) {
    const reasonCode = `confidence below 80% (${Math.round(input.confidenceScore * 100)}%)`;
    return {
      outcome: "review",
      reasonCode,
      gates,
      paymentAmount: persistence.paymentAmount,
      approvalStatus: persistence.approvalStatus,
      shouldCreatePayment: false,
      shouldAppendToSheet: false,
      blockReason: reasonCode,
    };
  }

  if (!persistence.shouldCreatePayment) {
    return {
      outcome: "review",
      reasonCode: persistence.blockReason,
      gates,
      paymentAmount: persistence.paymentAmount,
      approvalStatus: persistence.approvalStatus,
      shouldCreatePayment: false,
      shouldAppendToSheet: false,
      blockReason: persistence.blockReason,
    };
  }

  return {
    outcome: "pass",
    reasonCode: null,
    gates,
    paymentAmount: persistence.paymentAmount,
    approvalStatus: persistence.approvalStatus,
    shouldCreatePayment: true,
    shouldAppendToSheet: persistence.shouldAppendToSheet,
    blockReason: null,
  };
}

export function evaluateFreshAmountGateForManualApproval(input: {
  parsedFieldsJson?: unknown;
  totalAmount: number;
}): AmountGateSnapshot {
  const moneyDecision = buildMoneyDecisionForReview(input);
  if (!moneyDecision) {
    return evaluateAmountGate({
      moneyDecision: {
        selectedAmount: null,
        amountBeforeVat: null,
        vatAmount: null,
        currency: "ILS",
        confidence: 0,
        evidenceScore: 0,
        reason: "missing amount",
        reasonCode: "AMBIGUOUS",
        candidates: [],
        rejected: [],
        status: "missing",
        ambiguityFlags: [],
        version: ARC_VERSION,
        isStrongEnoughForAutoSave: false,
      },
      fseSummary: parseFseSummaryFromParsedFields(input.parsedFieldsJson),
    });
  }
  return evaluateAmountGate({
    moneyDecision,
    fseSummary: parseFseSummaryFromParsedFields(input.parsedFieldsJson),
  });
}

export function evaluateFreshTrustGatesForManualApproval(input: {
  parsedFieldsJson?: unknown;
  totalAmount: number;
  supplierName?: string | null;
  fingerprintGateInput: FingerprintGateInput;
  duplicateGateInput: DuplicateGateInput;
}): FinanceTrustEvaluation {
  const amountApproval = amountGateAllowsManualApproval({
    parsedFieldsJson: input.parsedFieldsJson,
    totalAmount: input.totalAmount,
  });
  const amountGate = evaluateFreshAmountGateForManualApproval({
    parsedFieldsJson: input.parsedFieldsJson,
    totalAmount: input.totalAmount,
  });
  const supplierGate = evaluateSupplierGate({
    sirSummary: sirSummaryFromParsedFields(input.parsedFieldsJson),
    supplierName: input.supplierName,
  });
  const fingerprintGate = evaluateFingerprintGate(input.fingerprintGateInput);
  const duplicateGate = evaluateDuplicateGate(input.duplicateGateInput);

  if (!amountApproval.allowed) {
    const blockedReason = amountApproval.reasonCode ?? amountGate.reasonCode;
    return evaluateFinanceTrustGates({
      amountGate: {
        ...amountGate,
        verdict: "review",
        reasonCode: blockedReason as AmountGateSnapshot["reasonCode"],
      },
      supplierGate,
      fingerprintGate,
      duplicateGate,
      selectedAmount: input.totalAmount,
      needsReview: false,
    });
  }

  return evaluateFinanceTrustGates({
    amountGate,
    supplierGate,
    fingerprintGate,
    duplicateGate,
    selectedAmount: input.totalAmount,
    needsReview: false,
  });
}

export async function createSupplierPaymentIfTrusted(input: {
  evaluation: FinanceTrustEvaluation;
  data: Prisma.SupplierPaymentUncheckedCreateInput;
  upsert?: {
    where: Prisma.SupplierPaymentWhereUniqueInput;
    update?: Prisma.SupplierPaymentUncheckedUpdateInput;
  };
  audit?: PlatformAuditActorContext;
  sourceLookup?: {
    gmailMessageId?: string | null;
  };
  parsedFieldsJson?: unknown;
  uncertaintyReason?: string | null;
}): Promise<CreateSupplierPaymentIfTrustedResult> {
  const { evaluation } = input;
  const parsedFieldsJson = input.parsedFieldsJson;
  const uncertaintyReason = input.uncertaintyReason ?? null;
  const organizationId = typeof input.data.organizationId === "string" ? input.data.organizationId : null;
  const emailMessageId =
    typeof input.data.emailMessageId === "string" ? input.data.emailMessageId : null;
  const workflowTrace = createCoreWorkflowTrace({
    subsystem: "payment_creation",
    organizationId,
    gmailMessageId: input.sourceLookup?.gmailMessageId ?? null,
    emailMessageId,
    workflow: "payment_creation",
  });
  emitCoreWorkflowAudit(workflowTrace, "started", "create_payment");

  if (
    !evaluation.shouldCreatePayment ||
    evaluation.outcome !== "pass" ||
    isBlockedDocumentOutcome(parsedFieldsJson, uncertaintyReason)
  ) {
    const reason = isBlockedDocumentOutcome(parsedFieldsJson, uncertaintyReason)
      ? BLOCKED_OUTCOME_PERSISTENCE_REASON
      : evaluation.blockReason ?? evaluation.reasonCode;
    completeCoreWorkflowStage(workflowTrace, "create_payment", "skipped", {
      message: reason,
      health: "Degraded",
      metadata: { reason },
    });
    return {
      payment: null,
      skipped: true,
      reason,
      evaluation,
    };
  }

  try {
  const documentFingerprint =
    typeof input.data.documentFingerprint === "string" ? input.data.documentFingerprint : null;

  assertNewSupplierPaymentQuality({
    amount: typeof input.data.amount === "number" ? input.data.amount : null,
    documentFingerprint,
    documentType: typeof input.data.documentTypeDetailed === "string" ? input.data.documentTypeDetailed : null,
  });

  if (organizationId) {
    const existingSourcePayment = await findActiveSupplierPaymentForSource({
      organizationId,
      emailMessageId,
      gmailMessageId: input.sourceLookup?.gmailMessageId ?? null,
      documentFingerprint,
    });
    if (existingSourcePayment && !input.upsert) {
      completeCoreWorkflowStage(workflowTrace, "create_payment", "skipped", {
        message: duplicateSupplierPaymentBlockReason(existingSourcePayment),
        health: "Healthy",
        metadata: { existingPaymentId: existingSourcePayment.id },
      });
      return {
        payment: existingSourcePayment,
        skipped: true,
        reason: duplicateSupplierPaymentBlockReason(existingSourcePayment),
        evaluation,
      };
    }
  }

  if (input.upsert) {
    const existing = await prisma.supplierPayment.findUnique({
      where: input.upsert.where,
      select: {
        id: true,
        supplier: true,
        amount: true,
        currency: true,
        paid: true,
        approvalStatus: true,
        emailMessageId: true,
        documentFingerprint: true,
        organizationId: true,
      },
    });
    const payment = await prisma.supplierPayment.upsert({
      where: input.upsert.where,
      create: input.data,
      update: input.upsert.update ?? {},
    });
    const auditCtx =
      input.audit ??
      aiAuditContext(
        FINANCE_TRUST_PERSISTENCE_MODULE,
        resolveCoreWorkflowCorrelationId({
          emailMessageId,
          gmailMessageId: input.sourceLookup?.gmailMessageId ?? null,
        }),
      );
    recordPlatformAudit({
      ...auditCtx,
      organizationId: payment.organizationId,
      entityType: "supplier_payment",
      entityId: payment.id,
      action: existing ? "payment_updated" : "payment_created",
      beforeState: existing ? paymentAuditSnapshot(existing) : null,
      afterState: paymentAuditSnapshot(payment),
    });
    completeCoreWorkflowStage(workflowTrace, "create_payment", "completed", {
      health: "Healthy",
      metadata: { paymentId: payment.id, action: existing ? "payment_updated" : "payment_created" },
    });
    return { payment, skipped: false, reason: null, evaluation };
  }

  const payment = await prisma.supplierPayment.create({ data: input.data });
  const auditCtx =
    input.audit ??
    aiAuditContext(
      FINANCE_TRUST_PERSISTENCE_MODULE,
      resolveCoreWorkflowCorrelationId({
        emailMessageId,
        gmailMessageId: input.sourceLookup?.gmailMessageId ?? null,
      }),
    );
  recordPlatformAudit({
    ...auditCtx,
    organizationId: payment.organizationId,
    entityType: "supplier_payment",
    entityId: payment.id,
    action: "payment_created",
    afterState: paymentAuditSnapshot(payment),
  });
  completeCoreWorkflowStage(workflowTrace, "create_payment", "completed", {
    health: "Healthy",
    metadata: { paymentId: payment.id, action: "payment_created" },
  });
  return { payment, skipped: false, reason: null, evaluation };
  } catch (error) {
    emitCoreWorkflowFailure(workflowTrace, "create_payment", error);
    throw error;
  }
}

export function financeIngestionPathsForStaticGuard(): string[] {
  return [
    "src/services/gmail-sync.ts",
    "src/services/financialDocuments.ts",
    "src/services/whatsappInvoiceIngestion.ts",
    "src/services/clientGmailSync.ts",
    "src/services/invoiceBackfill.ts",
    "src/routes/api.ts",
    "src/routes/webhooks.ts",
  ];
}

export const FINANCE_TRUST_PERSISTENCE_MODULE = "src/services/trust/financeTrustPersistence.ts";
