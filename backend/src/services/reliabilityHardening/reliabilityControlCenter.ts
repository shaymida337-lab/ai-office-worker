import type { HardeningLayerId } from "./hardeningTypes.js";

export type ReliabilityControlCenterPanel = {
  panelId: string;
  title: string;
  layerId: HardeningLayerId | "foundation";
  status: "healthy" | "degraded" | "unhealthy" | "not_configured";
  summary: string | null;
  detailPath: string | null;
};

export const RELIABILITY_CONTROL_CENTER_PANELS: readonly ReliabilityControlCenterPanel[] = [
  panel("global_health", "Global System Health", "foundation", "/reliability/health"),
  panel("scanner_health", "Scanner Health", "data_integrity_watch", "/api/scanner/health"),
  panel("gmail_health", "Gmail Health", "dependency_health", "/reliability/gmail"),
  panel("drive_health", "Drive Health", "dependency_health", "/reliability/drive"),
  panel("claude_health", "Claude Health", "dependency_health", "/reliability/claude"),
  panel("golden_tests", "Golden Test Suite", "release_certificate", "/reliability/golden"),
  panel("journey_tests", "Journey Tests", "release_certificate", "/reliability/journeys"),
  panel("data_integrity", "Data Integrity Watch", "data_integrity_watch", "/reliability/integrity"),
  panel("ai_auditor", "AI Auditor Findings", "ai_auditor", "/reliability/auditor"),
  panel("active_incidents", "Active Incidents", "auto_rollback", "/reliability/incidents"),
  panel("release_certificates", "Release Certificates", "release_certificate", "/reliability/releases"),
  panel("dependency_health", "Dependency Health", "dependency_health", "/reliability/dependencies"),
  panel("recovery_actions", "Recovery Actions", "recovery_engine", "/reliability/recovery"),
  panel("audit_log", "Audit Log Viewer", "audit_log", "/reliability/audit-log"),
];

function panel(
  panelId: string,
  title: string,
  layerId: ReliabilityControlCenterPanel["layerId"],
  detailPath: string,
): ReliabilityControlCenterPanel {
  return {
    panelId,
    title,
    layerId,
    status: "not_configured",
    summary: null,
    detailPath,
  };
}

export type ReliabilityControlCenterSnapshot = {
  generatedAt: string;
  operatorAccessOnly: true;
  panels: ReliabilityControlCenterPanel[];
  overallStatus: "healthy" | "degraded" | "unhealthy";
  activeIncidentCount: number;
  lastReleaseCertificateId: string | null;
};

export function buildReliabilityControlCenterSnapshot(
  panels: ReliabilityControlCenterPanel[] = [...RELIABILITY_CONTROL_CENTER_PANELS],
): ReliabilityControlCenterSnapshot {
  const unhealthy = panels.filter((p) => p.status === "unhealthy").length;
  const degraded = panels.filter((p) => p.status === "degraded").length;

  return {
    generatedAt: new Date().toISOString(),
    operatorAccessOnly: true,
    panels,
    overallStatus: unhealthy > 0 ? "unhealthy" : degraded > 0 ? "degraded" : "healthy",
    activeIncidentCount: 0,
    lastReleaseCertificateId: null,
  };
}

export function listControlCenterPanels(): ReliabilityControlCenterPanel[] {
  return [...RELIABILITY_CONTROL_CENTER_PANELS];
}
