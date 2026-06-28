import { parseAmountGateFromParsedFields } from "./amountGate.js";
import { FINANCE_AMOUNT_UNRESOLVED_REASON } from "./amountGate.js";
import { roundMoney } from "./parseAmountHelpers.js";

export { FINANCE_AMOUNT_UNRESOLVED_REASON };
export const FINANCE_AMOUNT_MISSING_LABEL = "סכום חסר" as const;
export const FINANCE_AMOUNT_REVIEW_LABEL = "דורש בדיקה" as const;

const AMOUNT_GATE_MISSING_REASONS = new Set([
  FINANCE_AMOUNT_UNRESOLVED_REASON,
  "amount.zero",
  "amount.arc_missing",
  "amount.invalid",
  "amount.negative",
]);

export type ArcAmountSnapshot = {
  status: string | null;
  selectedAmount: number | null;
  reasonCode: string | null;
};

export type FinanceDisplayAmountInput = {
  totalAmount?: number | null;
  amount?: number | null;
  parsedFieldsJson?: unknown;
  currency?: string | null;
};

export type FinanceDisplayAmount = {
  amount: number | null;
  amountLabel: string;
  resolved: boolean;
  arcStatus: string | null;
  arcReasonCode: string | null;
};

export function parseArcAmountSnapshot(parsedFieldsJson: unknown): ArcAmountSnapshot | null {
  if (!parsedFieldsJson || typeof parsedFieldsJson !== "object" || parsedFieldsJson === null) {
    return null;
  }
  const arc = (parsedFieldsJson as { arc?: unknown }).arc;
  if (!arc || typeof arc !== "object" || arc === null) {
    return null;
  }
  const record = arc as Record<string, unknown>;
  return {
    status: typeof record.status === "string" ? record.status : null,
    selectedAmount:
      typeof record.selectedAmount === "number" && Number.isFinite(record.selectedAmount)
        ? record.selectedAmount
        : null,
    reasonCode: typeof record.reasonCode === "string" ? record.reasonCode : null,
  };
}

export function isCanonicalFinanceAmountResolved(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Canonical persisted/display amount — ignores regex-only parsed_fields_json.amount. */
export function resolveCanonicalFinanceAmount(input: FinanceDisplayAmountInput): number | null {
  const arc = parseArcAmountSnapshot(input.parsedFieldsJson);

  if (isCanonicalFinanceAmountResolved(input.totalAmount)) {
    return roundMoney(input.totalAmount);
  }

  if (isCanonicalFinanceAmountResolved(input.amount)) {
    if (!arc || arc.status === "resolved") {
      return roundMoney(input.amount);
    }
  }

  if (arc?.status === "resolved" && isCanonicalFinanceAmountResolved(arc.selectedAmount)) {
    return roundMoney(arc.selectedAmount);
  }

  return null;
}

export function formatFinanceAmountLabel(
  amount: number | null,
  currency = "ILS",
  parsedFieldsJson?: unknown
): string {
  const gate = parseAmountGateFromParsedFields(parsedFieldsJson);
  if (gate?.verdict === "review") {
    return AMOUNT_GATE_MISSING_REASONS.has(gate.reasonCode)
      ? FINANCE_AMOUNT_MISSING_LABEL
      : FINANCE_AMOUNT_REVIEW_LABEL;
  }
  if (amount == null) return FINANCE_AMOUNT_MISSING_LABEL;
  const formatted = amount.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (currency === "ILS") return `₪${formatted}`;
  return `${formatted} ${currency}`;
}

export function resolveFinanceDisplayAmount(input: FinanceDisplayAmountInput): FinanceDisplayAmount {
  const arc = parseArcAmountSnapshot(input.parsedFieldsJson);
  const gate = parseAmountGateFromParsedFields(input.parsedFieldsJson);
  const amount =
    gate?.verdict === "pass" && gate.normalizedAmount != null
      ? gate.normalizedAmount
      : resolveCanonicalFinanceAmount(input);
  const currency = input.currency ?? "ILS";
  const gateBlocksDisplay = gate?.verdict === "review";
  return {
    amount: gateBlocksDisplay ? null : amount,
    amountLabel: formatFinanceAmountLabel(amount, currency, input.parsedFieldsJson),
    resolved: gate?.verdict === "pass" || (!gate && amount != null),
    arcStatus: arc?.status ?? null,
    arcReasonCode: arc?.reasonCode ?? null,
  };
}
