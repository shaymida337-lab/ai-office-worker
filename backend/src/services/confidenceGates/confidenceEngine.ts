import { auditNatalieDecision } from "../reliabilityHardening/aiAuditor.js";
import { evaluateBusinessRules } from "../trustArchitecture/businessRulesEngine.js";
import type {
  ConfidenceDecision,
  ConfidenceEvaluationInput,
  ConfidenceLevel,
  ConfidenceResult,
  ConfidenceThresholds,
} from "./confidenceTypes.js";
import { aggregateConfidenceEvidence } from "./confidenceEvidence.js";
import { DEFAULT_CONFIDENCE_THRESHOLDS } from "./confidenceConfig.js";
import { recordConfidenceDecisionAudit } from "./confidenceAudit.js";
import { emitConfidenceReliabilityEvent } from "./confidenceReliability.js";

export function evaluateConfidenceDecision(
  input: ConfidenceEvaluationInput,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceResult {
  const { finalScore, supportingEvidence, missingEvidence } = aggregateConfidenceEvidence(input);
  const blockingReasons: string[] = [];
  const reviewReasons: string[] = [];

  const auditorFinding = auditNatalieDecision({
    entityId: input.entityId,
    organizationId: input.organizationId,
    extractedAmount: input.amount,
    supplierName: input.supplierName,
    documentType: input.documentType,
    paymentDirection: input.paymentDirection,
    confidenceScore: finalScore,
    isDuplicate: input.isConfirmedDuplicate || input.isDuplicateSuspicion,
    autoSaveRecommended: finalScore >= thresholds.autoExecuteMin,
    outcomeStatus: "PENDING",
    correlationId: input.correlationId,
  });

  const aiAuditorObjections = [
    ...input.aiAuditorObjections,
    ...(auditorFinding.auditStatus !== "pass" ? [auditorFinding.explanation] : []),
  ];

  const businessEvaluations = evaluateBusinessRules({
    amount: input.amount,
    isFinancial: isFinancialDocument(input.documentType),
    paymentDirection: input.paymentDirection,
    isDuplicate: input.isConfirmedDuplicate,
    confidenceScore: finalScore,
    supplierName: input.supplierName,
    permissionDenied: input.permissionDenied,
    crossOrgMismatch: input.crossOrgMismatch,
    sourceTrusted: input.sourceTrusted,
    hasConflictingAmounts: input.hasConflictingAmounts,
    auditorFailed: auditorFinding.auditStatus === "fail",
  });

  const failedRules = businessEvaluations.filter((rule) => rule.result === "fail");
  const businessRuleViolations = [
    ...input.businessRuleViolations,
    ...failedRules.map((rule) => `${rule.ruleId}: ${rule.explanation}`),
  ];

  if (input.crossOrgMismatch) blockingReasons.push("cross_organization_violation");
  if (input.permissionDenied) blockingReasons.push("permission_denied");
  if (input.corruptedDocument) blockingReasons.push("corrupted_document");
  if (input.integrityCritical) blockingReasons.push("integrity_critical");
  if (!input.sourceTrusted) blockingReasons.push("untrusted_source");
  if (input.isConfirmedDuplicate) blockingReasons.push("confirmed_duplicate");
  if (input.amount === 0 && isFinancialDocument(input.documentType)) {
    blockingReasons.push("zero_amount_financial_document");
  }

  if (input.isDuplicateSuspicion && !input.isConfirmedDuplicate) {
    reviewReasons.push("duplicate_suspicion");
  }
  if (input.hasConflictingAmounts) reviewReasons.push("conflicting_amount");
  if (input.missingSupplier || !input.supplierName) reviewReasons.push("missing_supplier");
  if (!input.hasAttachment) reviewReasons.push("missing_attachment");
  if (input.unsupportedDocument) reviewReasons.push("unsupported_document");
  if (!input.paymentDirection || input.paymentDirection === "unknown") {
    reviewReasons.push("unknown_payment_direction");
  }
  if (input.integrityWarning) reviewReasons.push("integrity_warning");
  if (aiAuditorObjections.length > 0) reviewReasons.push("ai_auditor_objection");
  if (failedRules.some((rule) => rule.ruleId === "br-004")) reviewReasons.push("low_confidence");
  if (failedRules.some((rule) => rule.ruleId === "br-005")) reviewReasons.push("missing_supplier");
  if (failedRules.some((rule) => rule.ruleId === "br-009")) reviewReasons.push("conflicting_amount");

  let decision: ConfidenceDecision;
  let recommendedAction: string;
  let explanation: string;

  if (blockingReasons.length > 0) {
    decision = "BLOCKED";
    recommendedAction = "Do not execute automatically. Escalate or reject.";
    explanation = `Blocked: ${blockingReasons.join(", ")}`;
  } else if (
    finalScore < thresholds.blockedBelow ||
    failedRules.some((rule) => ["br-001", "br-003", "br-006", "br-007", "br-008"].includes(rule.ruleId))
  ) {
    decision = "BLOCKED";
    if (finalScore < thresholds.blockedBelow) blockingReasons.push("confidence_below_blocked_threshold");
    recommendedAction = "Operation forbidden due to policy or critically low confidence.";
    explanation = `Blocked: ${[...blockingReasons, ...businessRuleViolations].join("; ") || "policy violation"}`;
  } else if (
    finalScore < thresholds.autoExecuteMin ||
    reviewReasons.length > 0 ||
    failedRules.length > 0
  ) {
    decision = "REVIEW_REQUIRED";
    recommendedAction = "Route to manual review before any automatic action.";
    explanation =
      reviewReasons.length > 0
        ? `Review required: ${reviewReasons.join(", ")}`
        : `Confidence ${Math.round(finalScore * 100)}% below auto-execute threshold ${Math.round(thresholds.autoExecuteMin * 100)}%`;
  } else {
    decision = "AUTO_EXECUTE";
    recommendedAction = "Automatic execution is permitted.";
    explanation = `Confidence ${Math.round(finalScore * 100)}% meets auto-execute threshold with no blocking signals.`;
  }

  const confidenceLevel = deriveConfidenceLevel(decision, finalScore, thresholds);

  return {
    decision,
    confidenceScore: finalScore,
    confidenceLevel,
    explanation,
    supportingEvidence,
    missingEvidence,
    blockingReasons: [...new Set([...blockingReasons, ...reviewReasons.filter((r) => decision === "BLOCKED")])],
    recommendedAction,
    thresholds,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate and record audit + reliability side effects (never throws).
 */
export function evaluateAndRecordConfidenceDecision(
  input: ConfidenceEvaluationInput,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
  options?: { sourceRoute?: string | null; actorId?: string | null },
): ConfidenceResult {
  const result = evaluateConfidenceDecision(input, thresholds);
  recordConfidenceDecisionAudit({
    organizationId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    result,
    correlationId: input.correlationId ?? null,
    sourceRoute: options?.sourceRoute ?? null,
    actorId: options?.actorId ?? null,
  });
  emitConfidenceReliabilityEvent({
    organizationId: input.organizationId,
    entityId: input.entityId,
    entityType: input.entityType,
    result,
    correlationId: input.correlationId ?? null,
  });
  return result;
}

function deriveConfidenceLevel(
  decision: ConfidenceDecision,
  score: number,
  thresholds: ConfidenceThresholds,
): ConfidenceLevel {
  if (decision === "BLOCKED") return "critical";
  if (decision === "REVIEW_REQUIRED") return score >= thresholds.reviewRequiredMin ? "medium" : "low";
  return score >= thresholds.autoExecuteMin ? "high" : "medium";
}

function isFinancialDocument(documentType: string): boolean {
  const normalized = documentType.toLowerCase();
  return !normalized.includes("non_financial") && normalized !== "junk" && normalized !== "irrelevant";
}
