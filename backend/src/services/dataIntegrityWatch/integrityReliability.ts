import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import type { IntegrityFinding, IntegrityHealthExtension, IntegrityWatchReport } from "./integrityTypes.js";
import { severityToReliabilityEventSeverity } from "./integrityTypes.js";

export const INTEGRITY_RELIABILITY_EVENT_TYPES = [
  "integrity_check_failed",
  "integrity_critical_finding",
  "integrity_score_drop",
  "integrity_cross_org_anomaly",
] as const;

export function mapIntegrityFindingsToReliabilityEvents(
  findings: IntegrityFinding[],
  generatedAt: string,
): ReliabilityEvent[] {
  const failed = findings.filter((f) => f.status === "fail");
  return failed.map((finding) =>
    buildReliabilityEvent({
      subsystem: mapFindingToSubsystem(finding),
      stage: "integrity_watch",
      severity: severityToReliabilityEventSeverity(finding.severity),
      timestamp: generatedAt,
      organizationId: finding.organizationId,
      entityId: finding.entityId,
      correlationId: finding.correlationId ?? `integrity:${finding.checkId}:${finding.entityId ?? "org"}`,
      probableRootCause: finding.probableRootCause ?? finding.checkId,
      suggestedAction: finding.suggestedAction ?? "Review integrity finding",
      autoRecoverable: false,
      message: classifyIntegrityEventType(finding),
    }),
  );
}

function classifyIntegrityEventType(finding: IntegrityFinding): string {
  if (finding.checkId.includes("cross-org")) return "integrity_cross_org_anomaly";
  if (finding.severity === "critical") return "integrity_critical_finding";
  return "integrity_check_failed";
}

function mapFindingToSubsystem(finding: IntegrityFinding): ReliabilityEvent["subsystem"] {
  switch (finding.category) {
    case "financial":
      return "payments";
    case "scanner":
      return "scanner";
    case "organization":
      return "scanner";
    case "dashboard":
      return "dashboard";
    case "integration":
      return "gmail";
    default:
      return "scanner";
  }
}

export function buildIntegrityHealthExtension(report: IntegrityWatchReport): IntegrityHealthExtension {
  return {
    integrityScore: report.overallIntegrityScore,
    integrityFailures: report.criticalFindings + report.warningFindings,
    criticalFindings: report.criticalFindings,
    warningFindings: report.warningFindings,
  };
}
