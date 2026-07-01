import type {
  BusinessRule,
  BusinessRuleEvaluation,
  BusinessRuleEvaluationResult,
} from "./trustTypes.js";
import { TRUST_ARCHITECTURE_VERSION } from "./trustTypes.js";

export const BUSINESS_RULES_CATALOG: readonly BusinessRule[] = [
  rule("br-001", "never auto-save amount=0", "blocker", "outcome_engine", "amount === 0 AND isFinancial", "blocked", "zero_amount_blocked"),
  rule("br-002", "never auto-save unknown payment direction", "critical", "outcome_engine", "paymentDirection is null OR unknown", "needs_review", "unknown_direction_review"),
  rule("br-003", "duplicate → block automatic persistence", "blocker", "outcome_engine", "duplicate fingerprint match", "blocked", "duplicate_regression_detected"),
  rule("br-004", "low confidence → review", "critical", "claude_extraction", "confidenceScore < 0.85", "needs_review", "confidence_drop_detected"),
  rule("br-005", "missing supplier → review", "critical", "claude_extraction", "supplierName is null on financial doc", "needs_review", "golden_case_failed"),
  rule("br-006", "permission denied → stop", "blocker", "trust_platform", "RBAC check failed", "stop", "permission_denied"),
  rule("br-007", "cross-org mismatch → critical", "blocker", "scanner", "organizationId mismatch on entity", "blocked", "isolation_regression_detected"),
  rule("br-008", "untrusted source → block", "critical", "scanner", "source trust level = untrusted", "blocked", "untrusted_source_blocked"),
  rule("br-009", "conflicting amounts → review", "warning", "claude_extraction", "multiple amount candidates conflict", "needs_review", "amount_ambiguity_review"),
  rule("br-010", "auditor fail → review", "critical", "trust_platform", "AI auditor status = fail", "needs_review", "auditor_review_required"),
];

function rule(
  ruleId: string,
  description: string,
  severity: BusinessRule["severity"],
  subsystem: BusinessRule["subsystem"],
  condition: string,
  action: BusinessRule["action"],
  linkedReliabilityEvent: string,
): BusinessRule {
  return {
    ruleId,
    version: TRUST_ARCHITECTURE_VERSION,
    description,
    severity,
    subsystem,
    enabled: true,
    condition,
    action,
    linkedReliabilityEvent,
  };
}

export type BusinessRuleContext = {
  amount: number | null;
  isFinancial: boolean;
  paymentDirection: string | null;
  isDuplicate: boolean;
  confidenceScore: number | null;
  supplierName: string | null;
  permissionDenied: boolean;
  crossOrgMismatch: boolean;
  sourceTrusted: boolean;
  hasConflictingAmounts: boolean;
  auditorFailed: boolean;
};

export function evaluateBusinessRules(context: BusinessRuleContext): BusinessRuleEvaluation[] {
  const evaluations: BusinessRuleEvaluation[] = [];
  const now = new Date().toISOString();

  evaluations.push(
    context.amount === 0 && context.isFinancial
      ? evalResult("br-001", "fail", "Zero amount on financial document", now)
      : evalResult("br-001", "pass", "Amount rule satisfied", now),
  );

  evaluations.push(
    !context.paymentDirection || context.paymentDirection === "unknown"
      ? evalResult("br-002", "fail", "Payment direction unknown", now)
      : evalResult("br-002", "pass", "Payment direction known", now),
  );

  evaluations.push(
    context.isDuplicate
      ? evalResult("br-003", "fail", "Duplicate detected — block persistence", now)
      : evalResult("br-003", "pass", "No duplicate", now),
  );

  evaluations.push(
    (context.confidenceScore ?? 0) < 0.85
      ? evalResult("br-004", "fail", "Confidence below auto-save threshold", now)
      : evalResult("br-004", "pass", "Confidence sufficient", now),
  );

  evaluations.push(
    context.isFinancial && !context.supplierName
      ? evalResult("br-005", "fail", "Missing supplier on financial document", now)
      : evalResult("br-005", "pass", "Supplier present or non-financial", now),
  );

  evaluations.push(
    context.permissionDenied
      ? evalResult("br-006", "fail", "Permission denied", now)
      : evalResult("br-006", "pass", "Permission granted", now),
  );

  evaluations.push(
    context.crossOrgMismatch
      ? evalResult("br-007", "fail", "Cross-org mismatch detected", now)
      : evalResult("br-007", "pass", "Organization isolated", now),
  );

  evaluations.push(
    !context.sourceTrusted
      ? evalResult("br-008", "fail", "Untrusted source", now)
      : evalResult("br-008", "pass", "Source trusted", now),
  );

  evaluations.push(
    context.hasConflictingAmounts
      ? evalResult("br-009", "fail", "Conflicting amount candidates", now)
      : evalResult("br-009", "pass", "No amount conflict", now),
  );

  evaluations.push(
    context.auditorFailed
      ? evalResult("br-010", "fail", "AI auditor failed", now)
      : evalResult("br-010", "pass", "AI auditor passed", now),
  );

  return evaluations;
}

function evalResult(
  ruleId: string,
  result: BusinessRuleEvaluationResult,
  explanation: string,
  evaluatedAt: string,
): BusinessRuleEvaluation {
  return { ruleId, result, explanation, evaluatedAt };
}

export function summarizeBusinessRuleEvaluations(evaluations: BusinessRuleEvaluation[]): {
  passed: number;
  failed: number;
  blockers: string[];
} {
  const failed = evaluations.filter((e) => e.result === "fail");
  const blockerIds = new Set(
    BUSINESS_RULES_CATALOG.filter((r) => r.severity === "blocker").map((r) => r.ruleId),
  );
  return {
    passed: evaluations.filter((e) => e.result === "pass").length,
    failed: failed.length,
    blockers: failed.filter((e) => blockerIds.has(e.ruleId)).map((e) => e.ruleId),
  };
}

export function getBusinessRule(ruleId: string): BusinessRule | undefined {
  return BUSINESS_RULES_CATALOG.find((r) => r.ruleId === ruleId);
}

export function listEnabledBusinessRules(): BusinessRule[] {
  return BUSINESS_RULES_CATALOG.filter((r) => r.enabled);
}
