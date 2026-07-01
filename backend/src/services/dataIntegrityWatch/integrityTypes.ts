/**
 * Data Integrity Watch — read-only production verification layer.
 * Never modifies production data.
 */
import type { ReliabilityEventSeverity } from "../reliability/reliabilityTypes.js";

export const INTEGRITY_WATCH_VERSION = "data-integrity-watch-signal-v2" as const;

export const INTEGRITY_READ_ONLY_GUARANTEE = true as const;

export const INTEGRITY_CHECK_CATEGORIES = [
  "financial",
  "scanner",
  "organization",
  "dashboard",
  "integration",
] as const;

export type IntegrityCheckCategory = (typeof INTEGRITY_CHECK_CATEGORIES)[number];

export const INTEGRITY_FINDING_STATUSES = ["fail", "warn", "pass"] as const;

export type IntegrityFindingStatus = (typeof INTEGRITY_FINDING_STATUSES)[number];

export const INTEGRITY_SEVERITIES = ["critical", "important", "warning", "info"] as const;

export type IntegritySeverity = (typeof INTEGRITY_SEVERITIES)[number];

export const ORPHAN_SIGNAL_DISPOSITIONS = ["CRITICAL", "WARNING", "INFO", "IGNORED"] as const;

export type OrphanSignalDisposition = (typeof ORPHAN_SIGNAL_DISPOSITIONS)[number];

export type IntegrityCheckId = string;

export type IntegrityFinding = {
  checkId: IntegrityCheckId;
  category: IntegrityCheckCategory;
  severity: IntegritySeverity;
  organizationId: string;
  entityType: string;
  entityId: string | null;
  status: IntegrityFindingStatus;
  explanation: string;
  probableRootCause: string | null;
  suggestedAction: string | null;
  autoRecoverable: false;
  correlationId: string | null;
  detectedAt: string;
  findingConfidence: number;
  signalDisposition?: OrphanSignalDisposition | null;
};

export type IntegrityRunMode =
  | "manual"
  | "scheduled"
  | "organization"
  | "global"
  | "dry_run"
  | "incremental";

export type IntegrityRunOptions = {
  mode: IntegrityRunMode;
  organizationId?: string | null;
  dryRun?: boolean;
  now?: Date;
};

export type IntegrityNoiseAnalytics = {
  ignoredCount: number;
  ignoredByCheck: Record<string, number>;
  ignoredPercentage: number;
  falsePositiveCandidates: Array<{ checkId: string; count: number; reason: string }>;
  investigationCandidates: Array<{ checkId: string; count: number; reason: string }>;
  topNoisyValidators: Array<{ checkId: string; count: number; ignoredRate: number | null }>;
  severityCounts: Record<IntegritySeverity, number>;
  criticalTrendNote: string | null;
  warningTrendNote: string | null;
};

export type IntegrityOrgReport = {
  organizationId: string;
  integrityScore: number;
  findings: IntegrityFinding[];
  criticalCount: number;
  importantCount: number;
  warningCount: number;
  infoCount: number;
  checksRun: number;
  passed: boolean;
};

export type IntegritySignalQualityComparison = {
  before: {
    label: string;
    criticalFindings: number;
    warningFindings: number;
    infoFindings: number;
    importantFindings: number;
    ignoredOrphansEstimate: number;
    topCriticalChecks: ReadonlyArray<{ checkId: string; count: number }>;
  };
  after: {
    criticalFindings: number;
    warningFindings: number;
    infoFindings: number;
    importantFindings: number;
    ignoredCount: number;
  };
  criticalCountReduction: number;
  warningIncrease: number;
  infoIncrease: number;
  falsePositiveReductionEstimate: number;
  topRemainingRisks: Array<{ checkId: string; count: number }>;
};

export type IntegrityWatchReport = {
  schemaVersion: typeof INTEGRITY_WATCH_VERSION;
  generatedAt: string;
  mode: IntegrityRunMode;
  dryRun: boolean;
  organizationsScanned: number;
  overallIntegrityScore: number;
  criticalFindings: number;
  importantFindings: number;
  warningFindings: number;
  infoFindings: number;
  organizationReports: IntegrityOrgReport[];
  checksRun: number;
  checksImplemented: number;
  passed: boolean;
  noiseAnalytics: IntegrityNoiseAnalytics;
  signalQualityComparison: IntegritySignalQualityComparison | null;
};

export type IntegrityHealthExtension = {
  integrityScore: number;
  integrityFailures: number;
  criticalFindings: number;
  importantFindings: number;
  warningFindings: number;
};

export type IntegrityCheckDefinition = {
  checkId: IntegrityCheckId;
  category: IntegrityCheckCategory;
  title: string;
  description: string;
  defaultSeverity: IntegritySeverity;
  readOnly: true;
  implemented: boolean;
};

export function severityToReliabilityEventSeverity(
  severity: IntegritySeverity,
): ReliabilityEventSeverity {
  switch (severity) {
    case "critical":
      return "CRITICAL";
    case "important":
      return "IMPORTANT";
    case "warning":
      return "IMPORTANT";
    case "info":
      return "INFO";
    default:
      return "INFO";
  }
}
