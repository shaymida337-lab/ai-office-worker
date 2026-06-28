import type { MoneyDecision } from "./canonicalAmount.js";
import { MAX_REASONABLE_FINANCIAL_AMOUNT } from "../financialAmountLimits.js";
import {
  parseFinanceGateSnapshot,
  upsertFinanceGateSnapshot,
} from "../trust/financeGateSnapshots.js";
import { roundMoney } from "./parseAmountHelpers.js";

export const AMOUNT_GATE_VERSION = "amount-gate-v1" as const;

export const FINANCE_AMOUNT_UNRESOLVED_REASON = "amount.unresolved" as const;

export type AmountGateVerdict = "pass" | "review";

export type AmountGateReasonCode =
  | typeof FINANCE_AMOUNT_UNRESOLVED_REASON
  | "amount.zero"
  | "amount.invalid"
  | "amount.negative"
  | "amount.arc_missing"
  | "amount.arc_ambiguous"
  | "amount.arc_rejected"
  | "amount.decimal_shift"
  | "amount.source_conflict"
  | "amount.vat_mismatch"
  | "amount.weird_decimals"
  | "amount.threshold_exceeded"
  | "amount.fse_impossible"
  | "amount.fse_historical_anomaly"
  | "amount.resolved";

export type AmountGateSnapshot = {
  gate: "amount";
  verdict: AmountGateVerdict;
  reasonCode: AmountGateReasonCode;
  engineVersion: typeof AMOUNT_GATE_VERSION;
  normalizedAmount: number | null;
};

export type FseSummaryForAmountGate = {
  errors?: Array<{ ruleId: string }>;
  warnings?: Array<{ ruleId: string }>;
} | null;

export type AmountGateInput = {
  moneyDecision: MoneyDecision;
  fseSummary?: FseSummaryForAmountGate;
};

const ARC_REASON_TO_GATE: Partial<Record<string, AmountGateReasonCode>> = {
  DECIMAL_SHIFT: "amount.decimal_shift",
  SOURCE_CONFLICT: "amount.source_conflict",
  MISSING: "amount.arc_missing",
  AMBIGUOUS: "amount.arc_ambiguous",
  REJECTED_INVALID: "amount.arc_rejected",
};

function hasWeirdDecimals(amount: number): boolean {
  return Math.abs(amount - roundMoney(amount)) > 1e-9;
}

function fseRuleFailed(
  summary: FseSummaryForAmountGate | undefined,
  ruleId: string,
  severity: "error" | "warning" | "either" = "either"
): boolean {
  if (!summary) return false;
  if (severity === "error" || severity === "either") {
    if (summary.errors?.some((entry) => entry.ruleId === ruleId)) return true;
  }
  if (severity === "warning" || severity === "either") {
    if (summary.warnings?.some((entry) => entry.ruleId === ruleId)) return true;
  }
  return false;
}

function reviewReasonFromArc(moneyDecision: MoneyDecision): AmountGateReasonCode | null {
  if (moneyDecision.status === "missing") return "amount.arc_missing";
  if (moneyDecision.status === "ambiguous") {
    return ARC_REASON_TO_GATE[moneyDecision.reasonCode] ?? "amount.arc_ambiguous";
  }
  if (moneyDecision.status === "rejected") return "amount.arc_rejected";
  const mapped = ARC_REASON_TO_GATE[moneyDecision.reasonCode];
  if (mapped && mapped !== "amount.resolved") return mapped;
  return null;
}

function reviewReasonFromFse(
  moneyDecision: MoneyDecision,
  fseSummary: FseSummaryForAmountGate | undefined
): AmountGateReasonCode | null {
  if (!fseSummary) return null;

  if (fseRuleFailed(fseSummary, "vat_arithmetic")) {
    return "amount.vat_mismatch";
  }

  if (fseRuleFailed(fseSummary, "impossible_amount", "error")) {
    const amount = moneyDecision.selectedAmount;
    if (amount != null && Math.abs(amount) >= MAX_REASONABLE_FINANCIAL_AMOUNT) {
      return "amount.threshold_exceeded";
    }
    return "amount.fse_impossible";
  }

  if (fseRuleFailed(fseSummary, "impossible_amount", "warning")) {
    return "amount.zero";
  }

  if (fseRuleFailed(fseSummary, "supplier_historical_range", "warning")) {
    return "amount.fse_historical_anomaly";
  }

  return null;
}

export function evaluateAmountGate(input: AmountGateInput): AmountGateSnapshot {
  const { moneyDecision, fseSummary } = input;
  const selectedAmount = moneyDecision.selectedAmount;

  const arcReview = reviewReasonFromArc(moneyDecision);
  if (arcReview) {
    return buildSnapshot("review", arcReview, null);
  }

  if (selectedAmount == null) {
    return buildSnapshot("review", FINANCE_AMOUNT_UNRESOLVED_REASON, null);
  }

  if (!Number.isFinite(selectedAmount) || Number.isNaN(selectedAmount)) {
    return buildSnapshot("review", "amount.invalid", null);
  }

  if (selectedAmount < 0) {
    return buildSnapshot("review", "amount.negative", null);
  }

  if (selectedAmount === 0) {
    return buildSnapshot("review", "amount.zero", null);
  }

  if (selectedAmount >= MAX_REASONABLE_FINANCIAL_AMOUNT) {
    return buildSnapshot("review", "amount.threshold_exceeded", null);
  }

  if (moneyDecision.status !== "resolved") {
    return buildSnapshot("review", "amount.arc_ambiguous", null);
  }

  if (hasWeirdDecimals(selectedAmount)) {
    return buildSnapshot("review", "amount.weird_decimals", roundMoney(selectedAmount));
  }

  const fseReview = reviewReasonFromFse(moneyDecision, fseSummary);
  if (fseReview) {
    return buildSnapshot("review", fseReview, roundMoney(selectedAmount));
  }

  const normalizedAmount = roundMoney(selectedAmount);
  return buildSnapshot("pass", "amount.resolved", normalizedAmount);
}

function buildSnapshot(
  verdict: AmountGateVerdict,
  reasonCode: AmountGateReasonCode,
  normalizedAmount: number | null
): AmountGateSnapshot {
  return {
    gate: "amount",
    verdict,
    reasonCode,
    engineVersion: AMOUNT_GATE_VERSION,
    normalizedAmount,
  };
}

export function amountGatePasses(snapshot: AmountGateSnapshot | null | undefined): boolean {
  return snapshot?.verdict === "pass";
}

export function parseAmountGateFromParsedFields(parsedFieldsJson: unknown): AmountGateSnapshot | null {
  const record = parseFinanceGateSnapshot<AmountGateSnapshot & Record<string, unknown>>(
    parsedFieldsJson,
    "amount"
  );
  if (!record) return null;
  const verdict = record.verdict === "pass" || record.verdict === "review" ? record.verdict : null;
  if (!verdict) return null;
  const reasonCode =
    typeof record.reasonCode === "string" ? record.reasonCode : FINANCE_AMOUNT_UNRESOLVED_REASON;
  const normalizedAmount =
    typeof record.normalizedAmount === "number" && Number.isFinite(record.normalizedAmount)
      ? roundMoney(record.normalizedAmount)
      : null;
  return {
    gate: "amount",
    verdict,
    reasonCode: reasonCode as AmountGateReasonCode,
    engineVersion: AMOUNT_GATE_VERSION,
    normalizedAmount,
  };
}

export function attachAmountGateToParsedFields(
  parsedFieldsJson: Record<string, unknown>,
  input: AmountGateInput
): AmountGateSnapshot {
  const snapshot = evaluateAmountGate(input);
  upsertFinanceGateSnapshot(parsedFieldsJson, snapshot);
  return snapshot;
}
