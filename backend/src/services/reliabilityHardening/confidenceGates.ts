import type { ConfidenceGateOutcome, ConfidenceGateRule } from "./hardeningTypes.js";
import { NATALIE_UNCERTAINTY_RULE } from "./hardeningTypes.js";

export const CONFIDENCE_GATE_RULES: readonly ConfidenceGateRule[] = [
  rule("cg-001", "auto_save only above strict confidence threshold", "auto_save", [
    "confidenceScore >= 0.85",
    "amount is not null",
    "amount > 0",
    "paymentDirection is known",
    "not duplicate suspicion",
  ], 1),
  rule("cg-002", "needs_review if amount confidence is low", "needs_review", [
    "amount confidence < 0.75",
    "OR conflicting amount candidates",
  ], 2),
  rule("cg-003", "blocked if source is untrusted", "blocked", [
    "source trust level = untrusted",
    "OR corrupted attachment",
  ], 3),
  rule("cg-004", "never auto-save when payment direction unclear", "needs_review", [
    "paymentDirection is null OR unknown",
  ], 4),
  rule("cg-005", "never persist amount 0 unless expected non-financial", "blocked", [
    "amount = 0 AND documentType is financial",
  ], 5),
  rule("cg-006", "duplicate suspicion always blocks automatic persistence", "blocked", [
    "duplicate fingerprint match",
    "OR duplicate suspicion flag",
  ], 6),
];

function rule(
  ruleId: string,
  description: string,
  outcome: ConfidenceGateOutcome,
  conditions: string[],
  priority: number,
): ConfidenceGateRule {
  return { ruleId, description, outcome, conditions, priority };
}

export type ConfidenceGateInput = {
  confidenceScore: number | null;
  amount: number | null;
  amountConfidence: number | null;
  paymentDirection: string | null;
  documentType: string;
  isDuplicateSuspicion: boolean;
  sourceTrusted: boolean;
  hasConflictingAmounts: boolean;
};

export function evaluateConfidenceGates(input: ConfidenceGateInput): {
  outcome: ConfidenceGateOutcome;
  matchedRuleId: string;
  explanation: string;
} {
  if (!input.sourceTrusted) {
    return { outcome: "blocked", matchedRuleId: "cg-003", explanation: NATALIE_UNCERTAINTY_RULE };
  }
  if (input.isDuplicateSuspicion) {
    return { outcome: "blocked", matchedRuleId: "cg-006", explanation: "Duplicate suspicion blocks auto persistence" };
  }
  if (input.amount === 0 && isFinancialType(input.documentType)) {
    return { outcome: "blocked", matchedRuleId: "cg-005", explanation: "Zero amount on financial document" };
  }
  if (!input.paymentDirection || input.paymentDirection === "unknown") {
    return { outcome: "needs_review", matchedRuleId: "cg-004", explanation: "Payment direction unclear" };
  }
  if ((input.amountConfidence ?? input.confidenceScore ?? 0) < 0.75 || input.hasConflictingAmounts) {
    return { outcome: "needs_review", matchedRuleId: "cg-002", explanation: "Low amount confidence or conflict" };
  }
  const score = input.confidenceScore ?? 0;
  if (
    score >= 0.85 &&
    input.amount != null &&
    input.amount > 0 &&
    input.paymentDirection &&
    !input.isDuplicateSuspicion
  ) {
    return { outcome: "auto_save", matchedRuleId: "cg-001", explanation: "Strict confidence threshold met" };
  }
  return { outcome: "needs_review", matchedRuleId: "cg-002", explanation: NATALIE_UNCERTAINTY_RULE };
}

function isFinancialType(documentType: string): boolean {
  const normalized = documentType.toLowerCase();
  return !normalized.includes("non_financial") && normalized !== "junk";
}

export function listConfidenceGateRules(): ConfidenceGateRule[] {
  return [...CONFIDENCE_GATE_RULES].sort((a, b) => a.priority - b.priority);
}
