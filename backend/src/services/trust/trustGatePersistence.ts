import {
  amountGatePasses,
  evaluateAmountGate,
  FINANCE_AMOUNT_UNRESOLVED_REASON,
  parseAmountGateFromParsedFields,
  AMOUNT_GATE_VERSION,
  type AmountGateSnapshot,
  type FseSummaryForAmountGate,
} from "../amount/amountGate.js";
import { ARC_VERSION, type MoneyDecision } from "../amount/canonicalAmount.js";
import { parseArcAmountSnapshot, isCanonicalFinanceAmountResolved } from "../amount/financeDisplayAmount.js";
import {
  parseFingerprintGateFromParsedFields,
  FINGERPRINT_GATE_VERSION,
  type FingerprintGateSnapshot,
} from "../dedup/fingerprintGate.js";
import {
  parseDuplicateGateFromParsedFields,
  DUPLICATE_GATE_VERSION,
  type DuplicateGateSnapshot,
} from "../dedup/duplicateGate.js";
import {
  parseSupplierGateFromParsedFields,
  SUPPLIER_GATE_VERSION,
  type SupplierGateSnapshot,
} from "../supplier/supplierGate.js";

export const TRUST_GATES_MISSING = "trust.gates_missing" as const;
export const TRUST_AMOUNT_GATE_MISSING = "trust.amount_gate_missing" as const;
export const TRUST_SUPPLIER_GATE_MISSING = "trust.supplier_gate_missing" as const;
export const TRUST_FINGERPRINT_GATE_MISSING = "trust.fingerprint_gate_missing" as const;
export const TRUST_DUPLICATE_GATE_MISSING = "trust.duplicate_gate_missing" as const;
export const TRUST_GATE_FAILED = "trust.gate_failed" as const;

export type TrustGateReasonCode =
  | typeof TRUST_GATES_MISSING
  | typeof TRUST_AMOUNT_GATE_MISSING
  | typeof TRUST_SUPPLIER_GATE_MISSING
  | typeof TRUST_FINGERPRINT_GATE_MISSING
  | typeof TRUST_DUPLICATE_GATE_MISSING
  | typeof TRUST_GATE_FAILED;

export type TrustGateSet = {
  amountGate: AmountGateSnapshot | null;
  supplierGate: SupplierGateSnapshot | null;
  fingerprintGate: FingerprintGateSnapshot | null;
  duplicateGate: DuplicateGateSnapshot | null;
};

export function parseTrustGatesFromParsedFields(parsedFieldsJson: unknown): TrustGateSet {
  return {
    amountGate: parseAmountGateFromParsedFields(parsedFieldsJson),
    supplierGate: parseSupplierGateFromParsedFields(parsedFieldsJson),
    fingerprintGate: parseFingerprintGateFromParsedFields(parsedFieldsJson),
    duplicateGate: parseDuplicateGateFromParsedFields(parsedFieldsJson),
  };
}

export function trustGatesFailClosedReason(gates: TrustGateSet): string | null {
  if (!gates.amountGate) return TRUST_AMOUNT_GATE_MISSING;
  if (!gates.supplierGate) return TRUST_SUPPLIER_GATE_MISSING;
  if (!gates.fingerprintGate) return TRUST_FINGERPRINT_GATE_MISSING;
  if (!gates.duplicateGate) return TRUST_DUPLICATE_GATE_MISSING;
  if (gates.amountGate.verdict !== "pass") {
    return gates.amountGate.reasonCode ?? TRUST_GATE_FAILED;
  }
  if (gates.supplierGate.verdict !== "pass") {
    return gates.supplierGate.reasonCode ?? TRUST_GATE_FAILED;
  }
  if (gates.fingerprintGate.verdict !== "pass") {
    return gates.fingerprintGate.reasonCode ?? TRUST_GATE_FAILED;
  }
  if (gates.duplicateGate.verdict !== "pass") {
    return gates.duplicateGate.reasonCode ?? TRUST_GATE_FAILED;
  }
  return null;
}

export function allTrustGatesPass(gates: TrustGateSet): boolean {
  return trustGatesFailClosedReason(gates) === null;
}

export function parseFseSummaryFromParsedFields(parsedFieldsJson: unknown): FseSummaryForAmountGate {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || parsedFieldsJson === null) {
    return null;
  }
  const fse = (parsedFieldsJson as { fse?: unknown }).fse;
  if (!fse || typeof fse !== "object") return null;
  const record = fse as { errors?: unknown; warnings?: unknown };
  return {
    errors: Array.isArray(record.errors)
      ? record.errors.filter(
          (entry): entry is { ruleId: string } =>
            Boolean(entry) && typeof entry === "object" && typeof (entry as { ruleId?: string }).ruleId === "string"
        )
      : undefined,
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter(
          (entry): entry is { ruleId: string } =>
            Boolean(entry) && typeof entry === "object" && typeof (entry as { ruleId?: string }).ruleId === "string"
        )
      : undefined,
  };
}

export function buildMoneyDecisionForReview(input: {
  parsedFieldsJson?: unknown;
  totalAmount: number;
}): MoneyDecision | null {
  if (!isCanonicalFinanceAmountResolved(input.totalAmount)) return null;

  const arc = parseArcAmountSnapshot(input.parsedFieldsJson);
  if (arc?.status === "resolved" && isCanonicalFinanceAmountResolved(arc.selectedAmount)) {
    return {
      selectedAmount: arc.selectedAmount,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0.9,
      evidenceScore: 1,
      reason: "invoice total",
      reasonCode: "INVOICE_TOTAL",
      candidates: [],
      rejected: [],
      status: "resolved",
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: true,
    };
  }

  if (arc?.status && arc.status !== "resolved") {
    return {
      selectedAmount: arc.selectedAmount,
      amountBeforeVat: null,
      vatAmount: null,
      currency: "ILS",
      confidence: 0,
      evidenceScore: 0,
      reason: arc.status,
      reasonCode: (arc.reasonCode ?? "AMBIGUOUS") as MoneyDecision["reasonCode"],
      candidates: [],
      rejected: [],
      status: arc.status as MoneyDecision["status"],
      ambiguityFlags: [],
      version: ARC_VERSION,
      isStrongEnoughForAutoSave: false,
    };
  }

  return {
    selectedAmount: input.totalAmount,
    amountBeforeVat: null,
    vatAmount: null,
    currency: "ILS",
    confidence: 0.85,
    evidenceScore: 1,
    reason: "manual review approval",
    reasonCode: "INVOICE_TOTAL",
    candidates: [],
    rejected: [],
    status: "resolved",
    ambiguityFlags: [],
    version: ARC_VERSION,
    isStrongEnoughForAutoSave: true,
  };
}

export function amountGateAllowsManualApproval(input: {
  parsedFieldsJson?: unknown;
  totalAmount: number;
}): { allowed: boolean; reasonCode: string | null } {
  const moneyDecision = buildMoneyDecisionForReview(input);
  if (!moneyDecision) {
    return { allowed: false, reasonCode: FINANCE_AMOUNT_UNRESOLVED_REASON };
  }
  const gate = evaluateAmountGate({
    moneyDecision,
    fseSummary: parseFseSummaryFromParsedFields(input.parsedFieldsJson),
  });
  if (!amountGatePasses(gate)) {
    return { allowed: false, reasonCode: gate.reasonCode };
  }
  return { allowed: true, reasonCode: null };
}

export function supplierPaymentPersistenceDecision(input: {
  selectedAmount: number | null | undefined;
  needsReview: boolean;
  amountGate?: AmountGateSnapshot | null;
  supplierGate?: SupplierGateSnapshot | null;
  fingerprintGate?: FingerprintGateSnapshot | null;
  duplicateGate?: DuplicateGateSnapshot | null;
}) {
  const gateBlock = trustGatesFailClosedReason({
    amountGate: input.amountGate ?? null,
    supplierGate: input.supplierGate ?? null,
    fingerprintGate: input.fingerprintGate ?? null,
    duplicateGate: input.duplicateGate ?? null,
  });
  if (gateBlock) {
    return {
      paymentAmount: null,
      approvalStatus: "needs_review" as const,
      shouldCreatePayment: false,
      shouldAppendToSheet: false,
      blockReason: gateBlock,
    };
  }

  const paymentAmount = isCanonicalFinanceAmountResolved(input.selectedAmount)
    ? Number(input.selectedAmount.toFixed(2))
    : null;
  const missingAmount = paymentAmount == null;
  return {
    paymentAmount,
    approvalStatus: input.needsReview || missingAmount ? ("needs_review" as const) : ("approved" as const),
    shouldCreatePayment: !missingAmount,
    shouldAppendToSheet: !missingAmount && !input.needsReview,
    blockReason: missingAmount ? FINANCE_AMOUNT_UNRESOLVED_REASON : null,
  };
}

export function buildPassingTrustGateSnapshots(overrides: {
  amountGate?: Partial<AmountGateSnapshot>;
  supplierGate?: Partial<SupplierGateSnapshot>;
  fingerprintGate?: Partial<FingerprintGateSnapshot>;
  duplicateGate?: Partial<DuplicateGateSnapshot>;
} = {}) {
  return {
    amountGate: {
      gate: "amount" as const,
      verdict: "pass" as const,
      reasonCode: "amount.resolved" as const,
      engineVersion: AMOUNT_GATE_VERSION,
      normalizedAmount: 65,
      ...overrides.amountGate,
    },
    supplierGate: {
      gate: "supplier" as const,
      verdict: "pass" as const,
      reasonCode: "supplier.resolved" as const,
      engineVersion: SUPPLIER_GATE_VERSION,
      canonicalSupplierName: "Acme Supplies",
      ...overrides.supplierGate,
    },
    fingerprintGate: {
      gate: "fingerprint" as const,
      verdict: "pass" as const,
      reasonCode: "fingerprint.resolved" as const,
      engineVersion: FINGERPRINT_GATE_VERSION,
      documentFingerprint: "scfc-v1:test-fingerprint",
      tier: "invoice-amount" as const,
      ...overrides.fingerprintGate,
    },
    duplicateGate: {
      gate: "duplicate" as const,
      verdict: "pass" as const,
      reasonCode: "duplicate.none" as const,
      engineVersion: DUPLICATE_GATE_VERSION,
      matchedPaymentId: null,
      matchedReviewId: null,
      matchStrength: "none" as const,
      ...overrides.duplicateGate,
    },
  };
}
