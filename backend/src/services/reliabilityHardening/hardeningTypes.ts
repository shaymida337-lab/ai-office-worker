/**
 * Full Reliability Hardening Plan v1 — pre-launch platform contracts.
 * Planning + scaffold only: no scanner, payment, or production logic changes.
 */

export const HARDENING_PLAN_VERSION = "reliability-hardening-v1" as const;

/** Natalie core rule: if not sure, route to review — never guess on financial data. */
export const NATALIE_UNCERTAINTY_RULE =
  "If Natalie is not sure, Natalie must not guess. Route to review, emit reliability event, explain." as const;

export const HARDENING_LAYER_IDS = [
  "data_integrity_watch",
  "audit_log",
  "permissions_rbac",
  "confidence_gates",
  "ai_auditor",
  "release_certificate",
  "dependency_health",
  "configuration_validation",
  "shadow_mode",
  "canary_release",
  "auto_rollback",
  "recovery_engine",
  "disaster_recovery",
  "capacity_load_tests",
  "stability_tests",
  "ai_model_drift",
  "reliability_control_center",
] as const;

export type HardeningLayerId = (typeof HARDENING_LAYER_IDS)[number];

export const HARDENING_LAYER_PHASES = ["pre_launch_required", "pre_launch_recommended", "post_launch"] as const;

export type HardeningLayerPhase = (typeof HARDENING_LAYER_PHASES)[number];

export const HARDENING_IMPLEMENTATION_STATUSES = [
  "design_only",
  "scaffolded",
  "partial",
  "implemented",
] as const;

export type HardeningImplementationStatus = (typeof HARDENING_IMPLEMENTATION_STATUSES)[number];

export type HardeningLayerDefinition = {
  layerId: HardeningLayerId;
  version: typeof HARDENING_PLAN_VERSION;
  title: string;
  description: string;
  implementationOrder: number;
  phase: HardeningLayerPhase;
  status: HardeningImplementationStatus;
  measurable: boolean;
  testable: boolean;
  explainable: boolean;
  recoverable: boolean;
  permissionAware: boolean;
  safeByDefault: boolean;
  dependencies: HardeningLayerId[];
  tags: string[];
};

export const DATA_INTEGRITY_CHECK_KINDS = [
  "payment_without_source_document",
  "document_without_file",
  "invoice_without_organization",
  "duplicate_fingerprint",
  "zero_amount_financial_document",
  "missing_supplier_on_payment",
  "cross_org_data_anomaly",
  "review_stuck_too_long",
  "drive_link_mismatch",
  "dashboard_count_mismatch",
] as const;

export type DataIntegrityCheckKind = (typeof DATA_INTEGRITY_CHECK_KINDS)[number];

export const DATA_INTEGRITY_SEVERITIES = ["critical", "warning", "info"] as const;

export type DataIntegritySeverity = (typeof DATA_INTEGRITY_SEVERITIES)[number];

export type DataIntegrityFinding = {
  checkKind: DataIntegrityCheckKind;
  severity: DataIntegritySeverity;
  organizationId: string | null;
  entityType: string;
  entityId: string | null;
  explanation: string;
  suggestedAction: string;
  autoFixAllowed: false;
  detectedAt: string;
};

export const AI_AUDIT_STATUSES = ["pass", "warning", "fail"] as const;

export type AiAuditStatus = (typeof AI_AUDIT_STATUSES)[number];

export const AI_AUDIT_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type AiAuditRiskLevel = (typeof AI_AUDIT_RISK_LEVELS)[number];

export type AiAuditorFinding = {
  auditStatus: AiAuditStatus;
  riskLevel: AiAuditRiskLevel;
  explanation: string;
  suggestedAction: string;
  humanReviewRequired: boolean;
  inspectedFields: string[];
  entityId: string | null;
  organizationId: string | null;
  correlationId: string | null;
};

export const AUDIT_LOG_ACTOR_TYPES = ["user", "system", "AI"] as const;

export type AuditLogActorType = (typeof AUDIT_LOG_ACTOR_TYPES)[number];

export const AUDIT_LOG_ACTIONS = [
  "document_approved",
  "document_rejected",
  "payment_created",
  "payment_changed",
  "payment_deleted",
  "invoice_created",
  "permissions_changed",
  "integration_connected",
  "integration_disconnected",
  "auto_recovery_executed",
  "ai_decision_overridden",
] as const;

export type AuditLogAction = (typeof AUDIT_LOG_ACTIONS)[number];

export type AuditLogEntry = {
  actorType: AuditLogActorType;
  actorId: string | null;
  organizationId: string;
  entityType: string;
  entityId: string;
  action: AuditLogAction;
  before: unknown;
  after: unknown;
  reason: string | null;
  timestamp: string;
  correlationId: string | null;
  immutable: true;
};

export const RBAC_ROLES = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "employee",
  "external_accountant",
  "read_only",
] as const;

export type RbacRole = (typeof RBAC_ROLES)[number];

export const RBAC_ACTIONS = [
  "view_documents",
  "upload_documents",
  "approve_documents",
  "reject_documents",
  "create_payments",
  "edit_payments",
  "delete_payments",
  "export_reports",
  "connect_gmail",
  "connect_whatsapp",
  "manage_users",
  "manage_permissions",
  "view_audit_log",
  "manage_billing",
  "access_reliability_center",
] as const;

export type RbacAction = (typeof RBAC_ACTIONS)[number];

export const CONFIDENCE_GATE_OUTCOMES = ["auto_save", "needs_review", "blocked"] as const;

export type ConfidenceGateOutcome = (typeof CONFIDENCE_GATE_OUTCOMES)[number];

export type ConfidenceGateRule = {
  ruleId: string;
  description: string;
  outcome: ConfidenceGateOutcome;
  conditions: string[];
  priority: number;
};

export const SHADOW_MODE_SUBSYSTEMS = [
  "ai_extraction",
  "amount_parser",
  "supplier_detection",
  "deduplication",
  "outcome_engine",
  "whatsapp_ingestion",
  "payment_creation",
] as const;

export type ShadowModeSubsystem = (typeof SHADOW_MODE_SUBSYSTEMS)[number];

export const CANARY_STAGES = [
  "internal_org",
  "test_org",
  "pilot_1",
  "pilot_5",
  "pilot_20",
  "full_rollout",
] as const;

export type CanaryStage = (typeof CANARY_STAGES)[number];

export const ROLLBACK_TRIGGER_KINDS = [
  "scanner_error_rate_spike",
  "extraction_success_rate_drop",
  "amount_regression_detected",
  "duplicate_rate_spike",
  "cross_org_anomaly",
  "payment_persistence_anomaly",
  "critical_journey_failed",
  "health_endpoint_failed",
  "deployment_error_rate_exceeded",
] as const;

export type RollbackTriggerKind = (typeof ROLLBACK_TRIGGER_KINDS)[number];

export const RECOVERY_ALLOWED_OPERATIONS = [
  "retry_failed_scan",
  "requeue_stuck_job",
  "refresh_expired_integration_token",
  "rebuild_dashboard_cache",
  "retry_drive_save",
  "retry_notification_send",
] as const;

export const RECOVERY_FORBIDDEN_WITHOUT_APPROVAL = [
  "change_amount",
  "delete_payment",
  "approve_payment",
  "create_payment_after_blocked",
  "change_supplier",
  "change_permissions",
  "modify_invoice",
] as const;

export type RecoveryAllowedOperation = (typeof RECOVERY_ALLOWED_OPERATIONS)[number];

export type DisasterRecoveryMetrics = {
  rpoMinutes: number | null;
  rtoMinutes: number | null;
  restoreSuccessRate: number | null;
  lastVerifiedRestoreAt: string | null;
};

export const DEPENDENCY_IDS = [
  "gmail",
  "google_drive",
  "claude",
  "database",
  "render",
  "whatsapp_provider",
  "payment_provider",
  "email_delivery",
] as const;

export type DependencyId = (typeof DEPENDENCY_IDS)[number];

export type DependencyHealthSnapshot = {
  dependencyId: DependencyId;
  availability: number | null;
  latencyMs: number | null;
  errorRate: number | null;
  quotaUsage: number | null;
  lastSuccessfulCallAt: string | null;
  lastFailureAt: string | null;
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
};

export const RELEASE_DECISIONS = ["approved", "blocked"] as const;

export type ReleaseDecision = (typeof RELEASE_DECISIONS)[number];

export type ReleaseCertificate = {
  schemaVersion: typeof HARDENING_PLAN_VERSION;
  generatedAt: string;
  commitHash: string;
  deployId: string;
  buildResult: "pass" | "fail";
  testResults: { passed: number; failed: number; total: number };
  goldenSuiteResult: "pass" | "warn" | "fail" | "not_run";
  journeyResult: "pass" | "warn" | "fail" | "not_run";
  dataIntegrityResult: "pass" | "warn" | "fail" | "not_run";
  securityIsolationResult: "pass" | "warn" | "fail" | "not_run";
  dependencyHealth: "pass" | "warn" | "fail" | "not_run";
  rollbackReadiness: "ready" | "not_ready";
  reliabilityScore: number | null;
  releaseDecision: ReleaseDecision;
  blockers: string[];
  warnings: string[];
};

export type HardeningRiskEntry = {
  riskId: string;
  layerId: HardeningLayerId;
  title: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high" | "critical";
  mitigation: string;
  preLaunchRequired: boolean;
};
