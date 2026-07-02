/**
 * Customer Journey Reliability Framework v1 — end-to-end workflow validation.
 * Design + scaffold only: no production DB, no scanner/extraction changes.
 */
import type { ReliabilitySubsystemId } from "../reliability/reliabilityTypes.js";

export const JOURNEY_RELIABILITY_VERSION = "journey-reliability-v1" as const;

export const JOURNEY_CATEGORIES = [
  "financial_documents",
  "whatsapp",
  "manual_upload",
  "calendar",
  "tasks",
  "payments",
] as const;

export type JourneyCategory = (typeof JOURNEY_CATEGORIES)[number];

export const JOURNEY_CRITICALITIES = ["critical", "standard", "informational"] as const;

export type JourneyCriticality = (typeof JOURNEY_CRITICALITIES)[number];

export const JOURNEY_STEP_KINDS = [
  "gmail_ingest",
  "whatsapp_ingest",
  "manual_upload",
  "scan",
  "ocr",
  "ai_extraction",
  "classification",
  "decision",
  "drive_upload",
  "review",
  "persistence",
  "dashboard_visibility",
  "audit_log",
  "notification",
  "calendar_sync",
  "availability_check",
  "event_creation",
  "reminder",
  "task_creation",
  "task_assignment",
  "task_completion",
  "payment_approval",
  "report_generation",
] as const;

export type JourneyStepKind = (typeof JOURNEY_STEP_KINDS)[number];

export const JOURNEY_ASSERTION_KINDS = [
  "no_duplicate_records",
  "correct_fingerprint",
  "organization_isolation",
  "correct_supplier",
  "correct_amount",
  "correct_payment_direction",
  "correct_review_state",
  "confidence_threshold",
  "dashboard_state",
  "event_emission",
  "recovery_declaration",
  "correct_persistence",
  "correct_status",
  "audit_log_present",
  "permissions_enforced",
  "notification_sent",
  "no_incorrect_persistence",
  "no_data_corruption",
] as const;

export type JourneyAssertionKind = (typeof JOURNEY_ASSERTION_KINDS)[number];

export const JOURNEY_FAILURE_INJECTION_KINDS = [
  "claude_timeout",
  "drive_unavailable",
  "ocr_empty",
  "duplicate_document",
  "corrupted_pdf",
  "missing_attachment",
  "slow_processing",
  "network_failure",
  "expired_gmail_token",
  "expired_whatsapp_session",
  "permission_denied",
] as const;

export type JourneyFailureInjectionKind = (typeof JOURNEY_FAILURE_INJECTION_KINDS)[number];

export const JOURNEY_RELEASE_RECOMMENDATIONS = ["pass", "warn", "fail"] as const;

export type JourneyReleaseRecommendation = (typeof JOURNEY_RELEASE_RECOMMENDATIONS)[number];

export const JOURNEY_RUN_MODES = ["dry_run", "baseline_diff", "failure_injection"] as const;

export type JourneyRunMode = (typeof JOURNEY_RUN_MODES)[number];

export type JourneyStep = {
  stepId: string;
  kind: JourneyStepKind;
  subsystem: ReliabilitySubsystemId;
  label: string;
  optional?: boolean;
};

export type JourneyFailureScenario = {
  scenarioId: string;
  injection: JourneyFailureInjectionKind;
  atStepId: string;
  description?: string;
  expectedBehavior: {
    noIncorrectPersistence: boolean;
    noDataCorruption: boolean;
    properReviewRouting: boolean;
    reliabilityEventExpected: boolean;
    recoveryPathDeclared: boolean;
  };
};

export type JourneyExpectedOutcome = {
  persistenceAction: string;
  reviewStatus: string;
  decisionOutcome: string;
  dashboardVisible: boolean;
  supplierName?: string | null;
  amount?: number | null;
  currency?: string | null;
  paymentDirection?: string | null;
  fingerprint?: string | null;
  documentType?: string | null;
  recordCount?: number;
  auditLogEntries?: number;
  reliabilityEventTypes?: string[];
  notificationSent?: boolean;
  recoveryAutoRecoverable?: boolean;
};

export type JourneyDefinition = {
  journeyId: string;
  version: typeof JOURNEY_RELIABILITY_VERSION;
  category: JourneyCategory;
  title: string;
  description: string;
  criticality: JourneyCriticality;
  steps: JourneyStep[];
  assertions: JourneyAssertionKind[];
  expectedOutcome: JourneyExpectedOutcome;
  failureScenarios?: JourneyFailureScenario[];
  tags: string[];
  notes?: string | null;
  /** Bridge to golden-suite case for document pipeline steps */
  goldenSuiteCaseId?: string | null;
  /** Design-only flag — journey not yet executable */
  scaffoldOnly?: boolean;
  implemented?: boolean;
};

export type JourneyDataset = {
  version: typeof JOURNEY_RELIABILITY_VERSION;
  journeys: JourneyDefinition[];
};

export type JourneyStepResult = {
  stepId: string;
  kind: JourneyStepKind;
  status: "passed" | "failed" | "skipped" | "simulated";
  durationMs: number;
  message?: string | null;
};

export type JourneyAssertionResult = {
  assertion: JourneyAssertionKind;
  passed: boolean;
  classification: "failure" | "warning" | "pass";
  expected: unknown;
  actual: unknown;
  reason: string;
};

export type JourneyFailureInjectionResult = {
  scenarioId: string;
  injection: JourneyFailureInjectionKind;
  passed: boolean;
  failures: string[];
  warnings: string[];
};

export type JourneyRunResult = {
  journeyId: string;
  category: JourneyCategory;
  criticality: JourneyCriticality;
  passed: boolean;
  warnings: string[];
  failures: string[];
  stepResults: JourneyStepResult[];
  assertionResults: JourneyAssertionResult[];
  failureInjectionResults?: JourneyFailureInjectionResult[];
  processingDurationMs: number;
  reliabilityScore: number | null;
  tags: string[];
};

export type JourneyRunOptions = {
  mode: JourneyRunMode;
  dryRun: true;
  baselinePath?: string | null;
  injectFailures?: boolean;
  localFixturesRoot?: string;
};

export type JourneyBaselineDiff = {
  baselineId: string;
  newFailures: string[];
  resolvedFailures: string[];
  changedJourneys: Array<{ journeyId: string; field: string; before: unknown; after: unknown }>;
};

export type JourneyReliabilityReport = {
  schemaVersion: typeof JOURNEY_RELIABILITY_VERSION;
  generatedAt: string;
  mode: JourneyRunMode;
  totals: {
    journeys: number;
    passed: number;
    failed: number;
    warnings: number;
    criticalFailures: number;
    failureInjectionPassed: number;
    failureInjectionFailed: number;
  };
  journeyPassRate: number | null;
  averageProcessingDurationMs: number | null;
  reliabilityScore: number | null;
  releaseRecommendation: JourneyReleaseRecommendation;
  results: JourneyRunResult[];
  baselineDiff?: JourneyBaselineDiff | null;
};

/** Simulated end-state snapshot produced by dry-run (no real pipeline). */
export type JourneyActualSnapshot = {
  persistenceAction: string;
  reviewStatus: string;
  decisionOutcome: string;
  dashboardVisible: boolean;
  supplierName: string | null;
  amount: number | null;
  currency: string | null;
  paymentDirection: string | null;
  fingerprint: string | null;
  documentType: string | null;
  recordCount: number;
  auditLogEntries: number;
  reliabilityEventTypes: string[];
  notificationSent: boolean;
  recoveryAutoRecoverable: boolean;
  organizationId: string;
  duplicateDetected: boolean;
};
