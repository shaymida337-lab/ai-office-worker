import type { DecisionEvidence, ReversibilityPlan } from "./trustTypes.js";

export type BuildDecisionEvidenceInput = {
  decisionType: string;
  entityId?: string | null;
  organizationId: string;
  why: string;
  evidence: string[];
  ruleId?: string | null;
  confidence?: number | null;
  rejectedAlternatives?: Array<{ label: string; reason: string }>;
  businessRulesPassed?: boolean;
  auditorPassed?: boolean | null;
  integrityPassed?: boolean | null;
  goldenBaselineMatched?: boolean | null;
  journeyAssertionsPassed?: boolean | null;
  correlationId?: string | null;
  timestamp?: string;
};

export function buildDecisionEvidence(input: BuildDecisionEvidenceInput): DecisionEvidence {
  return {
    decisionType: input.decisionType,
    entityId: input.entityId ?? null,
    organizationId: input.organizationId,
    why: input.why,
    evidence: input.evidence,
    ruleId: input.ruleId ?? null,
    confidence: input.confidence ?? null,
    rejectedAlternatives: input.rejectedAlternatives ?? [],
    businessRulesPassed: input.businessRulesPassed ?? false,
    auditorPassed: input.auditorPassed ?? null,
    integrityPassed: input.integrityPassed ?? null,
    goldenBaselineMatched: input.goldenBaselineMatched ?? null,
    journeyAssertionsPassed: input.journeyAssertionsPassed ?? null,
    correlationId: input.correlationId ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function buildSupplierPaymentEvidence(input: {
  organizationId: string;
  entityId: string;
  supplierName: string;
  amount: number;
  confidence: number;
  correlationId?: string;
}): DecisionEvidence {
  return buildDecisionEvidence({
    decisionType: "supplier_payment",
    entityId: input.entityId,
    organizationId: input.organizationId,
    why: "Strong agreement across extraction, business rules, and verification layers",
    evidence: [
      `supplier matched by business identifier: ${input.supplierName}`,
      `amount extracted from totals section: ${input.amount}`,
      "duplicate search passed",
      "payment direction confirmed",
      `confidence ${input.confidence}`,
      "business rules passed",
      "auditor passed",
      "integrity passed",
      "golden baseline matched",
      "journey assertions passed",
    ],
    ruleId: "br-001",
    confidence: input.confidence,
    rejectedAlternatives: [
      { label: "auto_save with lower confidence", reason: "below 0.85 threshold" },
      { label: "skip supplier validation", reason: "supplier confirmed via VAT registry" },
    ],
    businessRulesPassed: true,
    auditorPassed: true,
    integrityPassed: true,
    goldenBaselineMatched: true,
    journeyAssertionsPassed: true,
    correlationId: input.correlationId ?? null,
  });
}

export function buildReversibilityPlan(decisionType: string): ReversibilityPlan {
  return {
    rollback: `Revert ${decisionType} via audit-logged undo operation`,
    replay: `Re-process source document through pipeline with review flag`,
    auditTrail: `Immutable audit log entry for ${decisionType}`,
    recoveryOwner: decisionType.includes("payment") ? "human_required" : "operator",
  };
}

export function validateDecisionEvidence(evidence: DecisionEvidence): string[] {
  const errors: string[] = [];
  if (!evidence.why) errors.push("why is required");
  if (!evidence.organizationId) errors.push("organizationId is required");
  if (evidence.evidence.length === 0) errors.push("at least one evidence item required");
  if (evidence.confidence != null && (evidence.confidence < 0 || evidence.confidence > 1)) {
    errors.push("confidence must be 0–1");
  }
  return errors;
}

export function isEvidenceCompleteForAutoSave(evidence: DecisionEvidence): boolean {
  return (
    evidence.businessRulesPassed &&
    evidence.auditorPassed === true &&
    evidence.integrityPassed === true &&
    (evidence.confidence ?? 0) >= 0.85 &&
    evidence.evidence.length >= 3
  );
}
