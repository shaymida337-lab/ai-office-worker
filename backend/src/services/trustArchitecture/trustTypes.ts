/**
 * Natalie Trust Architecture v1 — governing principles above all reliability layers.
 * Planning + scaffold only: no scanner, payment, or production logic changes.
 */
import type { ReliabilitySubsystemId } from "../reliability/reliabilityTypes.js";

export const TRUST_ARCHITECTURE_VERSION = "natalie-trust-v1" as const;

export const NATALIE_TRUST_PRINCIPLES = [
  "never_guess",
  "explainable_financial_actions",
  "reversible_financial_actions",
  "measurable_decisions",
  "fail_safely",
  "trust_requires_verification",
] as const;

export type NatalieTrustPrinciple = (typeof NATALIE_TRUST_PRINCIPLES)[number];

export const TRUST_VERIFICATION_CATEGORIES = [
  "reliability",
  "security",
  "permissions",
  "explainability",
  "recoverability",
  "observability",
  "testability",
  "isolation",
  "auditability",
  "performance",
] as const;

export type TrustVerificationCategory = (typeof TRUST_VERIFICATION_CATEGORIES)[number];

export type TrustVerificationStatus = "green" | "yellow" | "red" | "not_assessed";

export type TrustSubsystemEntry = {
  subsystemId: ReliabilitySubsystemId | "business_rules_engine" | "trust_platform";
  label: string;
  verification: Record<TrustVerificationCategory, TrustVerificationStatus>;
  productionReady: boolean;
  principles: NatalieTrustPrinciple[];
};

export const BUSINESS_RULE_SEVERITIES = ["info", "warning", "critical", "blocker"] as const;

export type BusinessRuleSeverity = (typeof BUSINESS_RULE_SEVERITIES)[number];

export type BusinessRuleEvaluationResult = "pass" | "fail" | "skip" | "not_evaluated";

export type BusinessRule = {
  ruleId: string;
  version: typeof TRUST_ARCHITECTURE_VERSION;
  description: string;
  severity: BusinessRuleSeverity;
  subsystem: ReliabilitySubsystemId | "trust_platform";
  enabled: boolean;
  condition: string;
  action: "auto_save" | "needs_review" | "blocked" | "stop" | "emit_event";
  linkedReliabilityEvent: string | null;
};

export type BusinessRuleEvaluation = {
  ruleId: string;
  result: BusinessRuleEvaluationResult;
  explanation: string;
  evaluatedAt: string;
};

export type RejectedAlternative = {
  label: string;
  reason: string;
};

export type DecisionEvidence = {
  decisionType: string;
  entityId: string | null;
  organizationId: string;
  why: string;
  evidence: string[];
  ruleId: string | null;
  confidence: number | null;
  rejectedAlternatives: RejectedAlternative[];
  businessRulesPassed: boolean;
  auditorPassed: boolean | null;
  integrityPassed: boolean | null;
  goldenBaselineMatched: boolean | null;
  journeyAssertionsPassed: boolean | null;
  correlationId: string | null;
  timestamp: string;
};

export type ReversibilityPlan = {
  rollback: string;
  replay: string;
  auditTrail: string;
  recoveryOwner: "system" | "operator" | "human_required";
};

export const TRUST_SCORE_INPUTS = [
  "health",
  "golden_tests",
  "journey_tests",
  "ai_auditor",
  "integrity_watch",
  "permissions",
  "audit_log",
  "security",
  "dependencies",
  "recovery",
  "configuration",
  "performance",
  "business_rules",
] as const;

export type TrustScoreInput = (typeof TRUST_SCORE_INPUTS)[number];

export type TrustScoreComponent = {
  input: TrustScoreInput;
  weight: number;
  score: number;
  status: "pass" | "warn" | "fail" | "not_run";
  critical: boolean;
};

export type TrustScore = {
  schemaVersion: typeof TRUST_ARCHITECTURE_VERSION;
  score: number;
  components: TrustScoreComponent[];
  criticalFailures: number;
  computedAt: string;
};

export const TRUST_CERTIFICATE_DECISIONS = ["approved", "blocked"] as const;

export type TrustCertificateDecision = (typeof TRUST_CERTIFICATE_DECISIONS)[number];

export type NatalieTrustCertificate = {
  schemaVersion: typeof TRUST_ARCHITECTURE_VERSION;
  generatedAt: string;
  commitHash: string;
  deployId: string;
  reliabilityScore: number | null;
  trustScore: number;
  goldenResult: "pass" | "warn" | "fail" | "not_run";
  journeyResult: "pass" | "warn" | "fail" | "not_run";
  integrityResult: "pass" | "warn" | "fail" | "not_run";
  permissionsResult: "pass" | "warn" | "fail" | "not_run";
  securityResult: "pass" | "warn" | "fail" | "not_run";
  auditResult: "pass" | "warn" | "fail" | "not_run";
  recoveryResult: "pass" | "warn" | "fail" | "not_run";
  dependenciesResult: "pass" | "warn" | "fail" | "not_run";
  configurationResult: "pass" | "warn" | "fail" | "not_run";
  businessRulesResult: "pass" | "warn" | "fail" | "not_run";
  approvedBy: string | null;
  releaseDecision: TrustCertificateDecision;
  blockers: string[];
  warnings: string[];
};

export type TrustDashboardSnapshot = {
  schemaVersion: typeof TRUST_ARCHITECTURE_VERSION;
  generatedAt: string;
  trustScore: number;
  criticalRisks: string[];
  businessRuleFailures: number;
  recentAiOverrides: number;
  goldenFailures: number;
  journeyFailures: number;
  integrityFindings: number;
  auditorFindings: number;
  dependencyFailures: number;
  pendingManualReviews: number;
  releaseReadiness: "ready" | "not_ready" | "blocked";
};

export const AI_SELF_VERIFICATION_CAPABILITIES = [
  "ai_cross_checking_ai",
  "automatic_anomaly_explanation",
  "self_diagnosis",
  "recommendation_engine",
  "safe_self_healing",
  "human_approval_workflow",
] as const;

export type AiSelfVerificationCapability = (typeof AI_SELF_VERIFICATION_CAPABILITIES)[number];

export type AiSelfVerificationPlaceholder = {
  capability: AiSelfVerificationCapability;
  status: "design_only";
  description: string;
  requiresHumanApproval: boolean;
};

export const SAFE_FAILURE_MODES = [
  "needs_review",
  "blocked",
  "retry",
  "queue",
  "notification",
] as const;

export const UNSAFE_FAILURE_MODES = [
  "wrong_amount",
  "wrong_supplier",
  "wrong_payment",
  "wrong_customer",
  "cross_org_leak",
] as const;

export type SafeFailureMode = (typeof SAFE_FAILURE_MODES)[number];
export type UnsafeFailureMode = (typeof UNSAFE_FAILURE_MODES)[number];
