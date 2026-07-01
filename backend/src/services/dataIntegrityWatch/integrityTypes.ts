/**
 * Data Integrity Watch v1 — read-only production verification layer.
 * Never modifies production data.
 */
import type { ReliabilityEventSeverity } from "../reliability/reliabilityTypes.js";

export const INTEGRITY_WATCH_VERSION = "data-integrity-watch-core-v1" as const;

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

export const INTEGRITY_SEVERITIES = ["critical", "warning", "info"] as const;

export type IntegritySeverity = (typeof INTEGRITY_SEVERITIES)[number];

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

export type IntegrityOrgReport = {
  organizationId: string;
  integrityScore: number;
  findings: IntegrityFinding[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  checksRun: number;
  passed: boolean;
};

export type IntegrityWatchReport = {
  schemaVersion: typeof INTEGRITY_WATCH_VERSION;
  generatedAt: string;
  mode: IntegrityRunMode;
  dryRun: boolean;
  organizationsScanned: number;
  overallIntegrityScore: number;
  criticalFindings: number;
  warningFindings: number;
  infoFindings: number;
  organizationReports: IntegrityOrgReport[];
  checksRun: number;
  checksImplemented: number;
  passed: boolean;
};

export type IntegrityHealthExtension = {
  integrityScore: number;
  integrityFailures: number;
  criticalFindings: number;
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
    case "warning":
      return "IMPORTANT";
    case "info":
      return "INFO";
    default:
      return "INFO";
  }
}
