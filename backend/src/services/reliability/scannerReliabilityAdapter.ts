import type { ScannerHealthApiResponse } from "../scanner/scannerHealthService.js";
import type { ScannerHealthSummary } from "../scanner/scannerHealthQueries.js";
import type { ScannerIsolationViolation, ScannerIsolationViolationType } from "../scanner/scannerIsolationChecks.js";
import { buildReliabilityEvent } from "./reliabilityEventModel.js";
import { buildSubsystemHealthContract } from "./reliabilityHealthContract.js";
import { buildReliabilityMetricSample } from "./reliabilityMetrics.js";
import { buildReliabilityDashboardSnapshot } from "./reliabilityDashboard.js";
import { getReliabilityRegistryEntry } from "./reliabilityRegistry.js";
import type {
  ReliabilityDashboardSnapshot,
  ReliabilityDashboardSubsystemPanel,
  ReliabilityEvent,
  ReliabilityEventSeverity,
  ReliabilityMetricSample,
  SubsystemHealthContract,
} from "./reliabilityTypes.js";
import { validateReliabilityEvent, validateSubsystemHealthContract } from "./reliabilityValidation.js";

const SCANNER_SUBSYSTEM_ID = "scanner" as const;

export type ScannerReliabilityAdapterInput = {
  healthResponse: ScannerHealthApiResponse;
  /** Full violation rows for event mapping (e.g. from isolation checks or failures endpoint). */
  violations?: ScannerIsolationViolation[];
};

export type ScannerReliabilityContribution = {
  subsystemId: typeof SCANNER_SUBSYSTEM_ID;
  contract: SubsystemHealthContract;
  events: ReliabilityEvent[];
  metricSamples: ReliabilityMetricSample[];
  panel: ReliabilityDashboardSubsystemPanel;
};

/**
 * Maps production scanner health API output to the shared SubsystemHealthContract.
 * Uses existing scanner-computed values only — no alternate metric formulas.
 */
export function adaptScannerHealthToSubsystemContract(
  response: ScannerHealthApiResponse,
): SubsystemHealthContract {
  const { health, violations, generatedAt } = response;
  const successRate = health.ingestion.ingestionSuccessRate;
  const activeAlerts = violations.bySeverity.critical;
  const warningCount = violations.bySeverity.warning + violations.bySeverity.info;

  return buildSubsystemHealthContract({
    subsystemId: SCANNER_SUBSYSTEM_ID,
    status: deriveScannerOperationalStatus(violations, successRate),
    successRate,
    errorRate: invertRate(successRate),
    queueSize: health.scans.stuckScanCount,
    retryCount: health.scans.scanErrorCount,
    averageProcessingTimeMs: null,
    lastSuccessfulExecutionAt: null,
    lastFailureAt: null,
    activeAlerts,
    warningCount,
    metrics: buildScannerStandardMetrics(health, successRate),
    summary: buildScannerHealthSummaryText(health, violations.total),
    checkedAt: generatedAt,
  });
}

export function mapScannerViolationsToReliabilityEvents(
  violations: ScannerIsolationViolation[],
  timestamp: string = new Date().toISOString(),
): ReliabilityEvent[] {
  return violations.map((violation) =>
    buildReliabilityEvent({
      subsystem: SCANNER_SUBSYSTEM_ID,
      stage: scannerViolationStage(violation.violationType),
      severity: mapScannerSeverityToReliability(violation.severity),
      timestamp,
      organizationId: violation.organizationId,
      entityId: violation.affectedIds[0] ?? null,
      correlationId: buildScannerViolationCorrelationId(violation),
      probableRootCause: violation.explanation,
      suggestedAction: violation.recommendedAction,
      autoRecoverable: violation.violationType === "stuck_active_scan",
      message: violation.violationType,
    }),
  );
}

export function buildScannerReliabilityMetricSamples(
  health: ScannerHealthSummary,
  successRate: number | null,
  recordedAt: string,
): ReliabilityMetricSample[] {
  return [
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "availability",
      value: successRate,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "success_rate",
      value: successRate,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "failure_rate",
      value: invertRate(successRate),
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "queue_depth",
      value: health.scans.stuckScanCount,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "stuck_jobs",
      value: health.scans.stuckScanCount,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "retry_rate",
      value: null,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "processing_latency",
      value: null,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "duplicate_rate",
      value: null,
      recordedAt,
    }),
    buildReliabilityMetricSample({
      subsystemId: SCANNER_SUBSYSTEM_ID,
      key: "false_positive_rate",
      value: null,
      recordedAt,
    }),
  ];
}

export function buildScannerReliabilityContribution(
  input: ScannerReliabilityAdapterInput,
): ScannerReliabilityContribution {
  const contract = adaptScannerHealthToSubsystemContract(input.healthResponse);
  const events = mapScannerViolationsToReliabilityEvents(
    input.violations ?? [],
    input.healthResponse.generatedAt,
  );
  const metricSamples = buildScannerReliabilityMetricSamples(
    input.healthResponse.health,
    input.healthResponse.health.ingestion.ingestionSuccessRate,
    input.healthResponse.generatedAt,
  );
  const registryEntry = getReliabilityRegistryEntry(SCANNER_SUBSYSTEM_ID);

  const panel: ReliabilityDashboardSubsystemPanel = {
    contract,
    recentEvents: events,
    metricSamples,
    recovery:
      registryEntry?.recovery ?? {
        subsystemId: SCANNER_SUBSYSTEM_ID,
        canRetry: false,
        canRestart: false,
        canRequeue: false,
        needsHumanReview: true,
        safeAutomaticRecovery: false,
      },
  };

  return {
    subsystemId: SCANNER_SUBSYSTEM_ID,
    contract,
    events,
    metricSamples,
    panel,
  };
}

/**
 * Merges scanner reliability data into a dashboard snapshot, replacing the default
 * scanner placeholder panel when present.
 */
export function mergeScannerIntoReliabilityDashboard(
  snapshot: ReliabilityDashboardSnapshot,
  scannerPanel: ReliabilityDashboardSubsystemPanel,
): ReliabilityDashboardSnapshot {
  const subsystems = snapshot.subsystems.map((panel) =>
    panel.contract.subsystemId === SCANNER_SUBSYSTEM_ID ? scannerPanel : panel,
  );

  const hasScanner = subsystems.some((panel) => panel.contract.subsystemId === SCANNER_SUBSYSTEM_ID);
  const mergedSubsystems = hasScanner ? subsystems : [...subsystems, scannerPanel];

  return buildReliabilityDashboardSnapshot({
    organizationId: snapshot.organizationId,
    generatedAt: snapshot.generatedAt,
    panels: mergedSubsystems,
  });
}

export function buildReliabilityDashboardWithScanner(
  input: ScannerReliabilityAdapterInput & { organizationId?: string | null },
): ReliabilityDashboardSnapshot {
  const contribution = buildScannerReliabilityContribution(input);
  const base = buildReliabilityDashboardSnapshot({
    organizationId: input.organizationId ?? input.healthResponse.organizationId,
    generatedAt: input.healthResponse.generatedAt,
  });
  return mergeScannerIntoReliabilityDashboard(base, contribution.panel);
}

function deriveScannerOperationalStatus(
  violations: ScannerHealthApiResponse["violations"],
  successRate: number | null,
): SubsystemHealthContract["status"] {
  if (violations.bySeverity.critical > 0) return "unhealthy";
  if (violations.bySeverity.warning > 0 || violations.bySeverity.info > 0) return "degraded";
  if (successRate == null) return "unknown";
  return "healthy";
}

function buildScannerStandardMetrics(
  health: ScannerHealthSummary,
  successRate: number | null,
): SubsystemHealthContract["metrics"] {
  return {
    availability: successRate,
    success_rate: successRate,
    failure_rate: invertRate(successRate),
    queue_depth: health.scans.stuckScanCount,
    stuck_jobs: health.scans.stuckScanCount,
    retry_rate: null,
    processing_latency: null,
    duplicate_rate: null,
    false_positive_rate: null,
  };
}

function buildScannerHealthSummaryText(health: ScannerHealthSummary, violationTotal: number): string {
  return [
    `ingested=${health.ingestion.emailsIngested}`,
    `processed=${health.ingestion.emailsProcessed}`,
    `gsi=${health.artifacts.gmailScanItemCount}`,
    `fdr=${health.artifacts.financialDocumentReviewCount}`,
    `stuck=${health.scans.stuckScanCount}`,
    `errors=${health.scans.scanErrorCount}`,
    `violations=${violationTotal}`,
  ].join(" ");
}

function invertRate(rate: number | null): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return 1 - rate;
}

function mapScannerSeverityToReliability(
  severity: ScannerIsolationViolation["severity"],
): ReliabilityEventSeverity {
  switch (severity) {
    case "critical":
      return "CRITICAL";
    case "warning":
      return "WARNING";
    case "info":
      return "INFO";
    default:
      return "INFO";
  }
}

function scannerViolationStage(violationType: ScannerIsolationViolationType): string {
  switch (violationType) {
    case "stuck_active_scan":
    case "cross_org_gmail_message_id":
    case "gmail_mailbox_mismatch":
      return "ingestion";
    case "drive_link_invoice_confusion":
      return "extraction";
    case "blocked_outcome_persisted":
      return "decision";
    case "duplicate_supplier_payment_fingerprint":
    case "auto_saved_without_attachment":
    case "fdr_without_gsi":
      return "persistence";
    default:
      return "unknown";
  }
}

function buildScannerViolationCorrelationId(violation: ScannerIsolationViolation): string {
  const primaryId = violation.affectedIds[0] ?? "none";
  return `scanner:${violation.violationType}:${primaryId}`;
}

export function validateScannerReliabilityContribution(
  contribution: ScannerReliabilityContribution,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contractValidation = validateSubsystemHealthContract(contribution.contract);
  if (!contractValidation.valid) errors.push(...contractValidation.errors);
  for (const event of contribution.events) {
    const eventValidation = validateReliabilityEvent(event);
    if (!eventValidation.valid) errors.push(...eventValidation.errors);
  }
  const registryEntry = getReliabilityRegistryEntry(SCANNER_SUBSYSTEM_ID);
  if (!registryEntry) errors.push("scanner registry entry missing");
  if (registryEntry && !registryEntry.monitored) errors.push("scanner must be monitored");
  if (registryEntry && registryEntry.placeholder) errors.push("scanner must not be placeholder");
  return { valid: errors.length === 0, errors };
}
