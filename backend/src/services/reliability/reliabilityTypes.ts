/**
 * Natalie Reliability Foundation — shared platform contracts.
 * Every subsystem (Gmail, WhatsApp, Dashboard, etc.) should converge on these types.
 */

/** Operational health of a subsystem at a point in time. */
export const RELIABILITY_HEALTH_STATUSES = [
  "healthy",
  "degraded",
  "unhealthy",
  "unknown",
  "not_configured",
] as const;

export type ReliabilityHealthStatus = (typeof RELIABILITY_HEALTH_STATUSES)[number];

/** Event severity ladder used across Natalie operations. */
export const RELIABILITY_EVENT_SEVERITIES = [
  "INFO",
  "WARNING",
  "IMPORTANT",
  "CRITICAL",
] as const;

export type ReliabilityEventSeverity = (typeof RELIABILITY_EVENT_SEVERITIES)[number];

/** Canonical subsystem identifiers for the reliability registry. */
export const RELIABILITY_SUBSYSTEM_IDS = [
  "scanner",
  "gmail",
  "drive",
  "claude_extraction",
  "outcome_engine",
  "payments",
  "invoice_creation",
  "dashboard",
  "tasks",
  "calendar",
  "whatsapp",
  "voice",
] as const;

export type ReliabilitySubsystemId = (typeof RELIABILITY_SUBSYSTEM_IDS)[number];

/** Standard metric keys every subsystem may publish. */
export const RELIABILITY_STANDARD_METRIC_KEYS = [
  "availability",
  "success_rate",
  "failure_rate",
  "processing_latency",
  "retry_rate",
  "queue_depth",
  "stuck_jobs",
  "duplicate_rate",
  "false_positive_rate",
] as const;

export type ReliabilityStandardMetricKey = (typeof RELIABILITY_STANDARD_METRIC_KEYS)[number];

export type ReliabilityIsoTimestamp = string;

export type ReliabilityRate = number | null;

export type ReliabilityDurationMs = number | null;

export type ReliabilityCount = number;

/**
 * Standard health contract — one shape for all Natalie subsystems.
 * Nullable fields mean "not reported yet" (distinct from zero).
 */
export type SubsystemHealthContract = {
  subsystemId: ReliabilitySubsystemId;
  status: ReliabilityHealthStatus;
  successRate: ReliabilityRate;
  errorRate: ReliabilityRate;
  queueSize: ReliabilityCount | null;
  retryCount: ReliabilityCount | null;
  averageProcessingTimeMs: ReliabilityDurationMs;
  lastSuccessfulExecutionAt: ReliabilityIsoTimestamp | null;
  lastFailureAt: ReliabilityIsoTimestamp | null;
  activeAlerts: ReliabilityCount;
  warningCount: ReliabilityCount;
  /** Optional extension metrics keyed by standard metric names. */
  metrics?: Partial<Record<ReliabilityStandardMetricKey, number | null>>;
  /** Human-readable summary for dashboard v2. */
  summary?: string | null;
  checkedAt: ReliabilityIsoTimestamp;
};

export type ReliabilityEvent = {
  subsystem: ReliabilitySubsystemId;
  stage: string;
  severity: ReliabilityEventSeverity;
  timestamp: ReliabilityIsoTimestamp;
  organizationId: string | null;
  entityId: string | null;
  correlationId: string | null;
  probableRootCause: string | null;
  suggestedAction: string | null;
  autoRecoverable: boolean;
  message?: string | null;
};

export type SubsystemRecoveryCapabilities = {
  subsystemId: ReliabilitySubsystemId;
  canRetry: boolean;
  canRestart: boolean;
  canRequeue: boolean;
  needsHumanReview: boolean;
  safeAutomaticRecovery: boolean;
  /** Design notes for future recovery implementers. */
  recoveryNotes?: string | null;
};

export type ReliabilityMetricSample = {
  subsystemId: ReliabilitySubsystemId;
  key: ReliabilityStandardMetricKey;
  value: number | null;
  unit: ReliabilityMetricUnit;
  recordedAt: ReliabilityIsoTimestamp;
  organizationId?: string | null;
};

export type ReliabilityMetricUnit = "ratio" | "count" | "milliseconds" | "percent";

export type ReliabilityRegistryEntry = {
  id: ReliabilitySubsystemId;
  label: string;
  description: string;
  category: ReliabilitySubsystemCategory;
  /** True when health collection is wired; false for placeholders. */
  monitored: boolean;
  placeholder: boolean;
  recovery: SubsystemRecoveryCapabilities;
  /** Stages this subsystem reports (pipeline-specific). */
  stages: readonly string[];
};

export type ReliabilitySubsystemCategory =
  | "ingestion"
  | "extraction"
  | "decision"
  | "persistence"
  | "integration"
  | "surface"
  | "ai"
  | "platform";

/** Health Dashboard v2 — uniform page payload per subsystem. */
export type ReliabilityDashboardSubsystemPanel = {
  contract: SubsystemHealthContract;
  recentEvents: ReliabilityEvent[];
  metricSamples: ReliabilityMetricSample[];
  recovery: SubsystemRecoveryCapabilities;
};

export type ReliabilityDashboardSnapshot = {
  schemaVersion: typeof RELIABILITY_DASHBOARD_SCHEMA_VERSION;
  generatedAt: ReliabilityIsoTimestamp;
  organizationId: string | null;
  subsystems: ReliabilityDashboardSubsystemPanel[];
  rollup: ReliabilityDashboardRollup;
};

export type ReliabilityDashboardRollup = {
  totalSubsystems: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  notConfiguredCount: number;
  activeAlerts: number;
  warningCount: number;
  criticalEventCount: number;
};

export const RELIABILITY_DASHBOARD_SCHEMA_VERSION = 1 as const;
