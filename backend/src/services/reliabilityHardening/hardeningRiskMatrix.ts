import type { HardeningRiskEntry } from "./hardeningTypes.js";

export const HARDENING_RISK_MATRIX: readonly HardeningRiskEntry[] = [
  risk("R-001", "data_integrity_watch", "Payment without source document", "medium", "critical", "Recurring integrity watch + golden tests", true),
  risk("R-002", "data_integrity_watch", "Cross-org data leak", "low", "critical", "Isolation checks + journey tests + audit log", true),
  risk("R-003", "confidence_gates", "Auto-save on low confidence", "medium", "critical", "Confidence gates + AI auditor second pass", true),
  risk("R-004", "permissions_rbac", "Financial action without permission", "medium", "critical", "RBAC on all payment/document mutations", true),
  risk("R-005", "ai_auditor", "Wrong amount persisted", "medium", "critical", "AI auditor + golden amount rules + review routing", true),
  risk("R-006", "audit_log", "Undetected sensitive change", "medium", "high", "Immutable audit log on all financial mutations", true),
  risk("R-007", "dependency_health", "Claude outage causes silent failure", "medium", "high", "Dependency health + reliability events + review routing", true),
  risk("R-008", "configuration_validation", "Missing secret in production", "low", "critical", "Pre-deploy config validation; fail safe", true),
  risk("R-009", "auto_rollback", "Regression deployed to all customers", "medium", "critical", "Canary release + auto rollback triggers", false),
  risk("R-010", "shadow_mode", "Untested extraction change in prod", "high", "high", "Shadow mode before promoting AI changes", false),
  risk("R-011", "recovery_engine", "Unsafe auto-recovery changes payment", "low", "critical", "Forbidden ops list; human approval required", true),
  risk("R-012", "disaster_recovery", "Unverified backup restore", "low", "critical", "Restore drills with RPO/RTO measurement", false),
  risk("R-013", "ai_model_drift", "Gradual AI quality degradation", "medium", "high", "Drift detection vs baseline metrics", false),
  risk("R-014", "capacity_load_tests", "Queue backlog under load", "medium", "medium", "Load tests + safe thresholds", false),
  risk("R-015", "release_certificate", "Release without full test gate", "low", "critical", "Release certificate blocks on critical failures", true),
] as const;

function risk(
  riskId: string,
  layerId: HardeningRiskEntry["layerId"],
  title: string,
  likelihood: HardeningRiskEntry["likelihood"],
  impact: HardeningRiskEntry["impact"],
  mitigation: string,
  preLaunchRequired: boolean,
): HardeningRiskEntry {
  return { riskId, layerId, title, likelihood, impact, mitigation, preLaunchRequired };
}

export function listPreLaunchRisks(): HardeningRiskEntry[] {
  return HARDENING_RISK_MATRIX.filter((r) => r.preLaunchRequired);
}

export function listCriticalImpactRisks(): HardeningRiskEntry[] {
  return HARDENING_RISK_MATRIX.filter((r) => r.impact === "critical");
}

export function computeRiskScore(entry: HardeningRiskEntry): number {
  const likelihoodScore = { low: 1, medium: 2, high: 3 }[entry.likelihood];
  const impactScore = { low: 1, medium: 2, high: 3, critical: 4 }[entry.impact];
  return likelihoodScore * impactScore;
}

export function rankRisksByScore(): HardeningRiskEntry[] {
  return [...HARDENING_RISK_MATRIX].sort((a, b) => computeRiskScore(b) - computeRiskScore(a));
}
