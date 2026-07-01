import type { AiAuditorFinding, AiAuditRiskLevel, AiAuditStatus } from "./hardeningTypes.js";

export const AI_AUDITOR_INSPECTED_FIELDS = [
  "extracted_amount",
  "supplier",
  "document_type",
  "payment_direction",
  "confidence_score",
  "duplicate_decision",
  "auto_save_decision",
  "blocked_routing",
  "needs_review_routing",
] as const;

export type AiAuditorInput = {
  entityId: string;
  organizationId: string;
  extractedAmount: number | null;
  supplierName: string | null;
  documentType: string;
  paymentDirection: string | null;
  confidenceScore: number | null;
  isDuplicate: boolean;
  autoSaveRecommended: boolean;
  outcomeStatus: string;
  correlationId?: string | null;
};

export function auditNatalieDecision(input: AiAuditorInput): AiAuditorFinding {
  const inspectedFields = [...AI_AUDITOR_INSPECTED_FIELDS];
  const issues: string[] = [];

  if (input.autoSaveRecommended && (input.confidenceScore ?? 0) < 0.85) {
    issues.push("auto-save recommended but confidence below strict threshold");
  }
  if (input.autoSaveRecommended && input.extractedAmount == null) {
    issues.push("auto-save recommended but amount is missing");
  }
  if (input.autoSaveRecommended && input.extractedAmount === 0) {
    issues.push("auto-save recommended but amount is zero");
  }
  if (input.autoSaveRecommended && !input.paymentDirection) {
    issues.push("auto-save recommended but payment direction unclear");
  }
  if (input.isDuplicate && input.autoSaveRecommended) {
    issues.push("duplicate suspicion but auto-save recommended");
  }
  if (input.outcomeStatus === "BLOCKED" && input.autoSaveRecommended) {
    issues.push("blocked outcome but auto-save recommended");
  }

  const auditStatus = deriveAuditStatus(issues);
  const riskLevel = deriveRiskLevel(auditStatus, issues);
  const humanReviewRequired = auditStatus !== "pass" || riskLevel === "high" || riskLevel === "critical";

  return {
    auditStatus,
    riskLevel,
    explanation: issues.length > 0 ? issues.join("; ") : "All inspected fields within policy",
    suggestedAction: humanReviewRequired ? "Route to human review before persistence" : "Proceed with documented confidence",
    humanReviewRequired,
    inspectedFields,
    entityId: input.entityId,
    organizationId: input.organizationId,
    correlationId: input.correlationId ?? null,
  };
}

function deriveAuditStatus(issues: string[]): AiAuditStatus {
  if (issues.some((i) => i.includes("duplicate") || i.includes("blocked"))) return "fail";
  if (issues.length > 0) return "warning";
  return "pass";
}

function deriveRiskLevel(status: AiAuditStatus, issues: string[]): AiAuditRiskLevel {
  if (status === "fail") return "critical";
  if (issues.length >= 2) return "high";
  if (issues.length === 1) return "medium";
  return "low";
}

export function summarizeAiAuditorResults(findings: AiAuditorFinding[]): {
  pass: number;
  warning: number;
  fail: number;
  humanReviewRequired: number;
} {
  return {
    pass: findings.filter((f) => f.auditStatus === "pass").length,
    warning: findings.filter((f) => f.auditStatus === "warning").length,
    fail: findings.filter((f) => f.auditStatus === "fail").length,
    humanReviewRequired: findings.filter((f) => f.humanReviewRequired).length,
  };
}
