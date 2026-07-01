import type { IntegrityFinding, IntegrityOrgReport } from "./integrityTypes.js";
import { listImplementedIntegrityCheckIds } from "./integrityRegistry.js";

export function computeOrgIntegrityScore(findings: IntegrityFinding[]): number {
  const failed = findings.filter((f) => f.status === "fail");
  const critical = failed.filter((f) => f.severity === "critical").length;
  const important = failed.filter((f) => f.severity === "important").length;
  const warning = failed.filter((f) => f.severity === "warning").length;
  const info = failed.filter((f) => f.severity === "info").length;

  const penalty = critical * 15 + important * 8 + warning * 5 + info * 1;
  return Math.max(0, Math.min(100, Math.round((100 - penalty) * 10) / 10));
}

export function buildIntegrityOrgReport(
  organizationId: string,
  findings: IntegrityFinding[],
): IntegrityOrgReport {
  const failed = findings.filter((f) => f.status === "fail");
  return {
    organizationId,
    integrityScore: computeOrgIntegrityScore(findings),
    findings,
    criticalCount: failed.filter((f) => f.severity === "critical").length,
    importantCount: failed.filter((f) => f.severity === "important").length,
    warningCount: failed.filter((f) => f.severity === "warning").length,
    infoCount: failed.filter((f) => f.severity === "info").length,
    checksRun: listImplementedIntegrityCheckIds().length,
    passed: failed.filter((f) => f.severity === "critical").length === 0,
  };
}

export function computeOverallIntegrityScore(reports: IntegrityOrgReport[]): number {
  if (reports.length === 0) return 100;
  const sum = reports.reduce((acc, r) => acc + r.integrityScore, 0);
  return Math.round((sum / reports.length) * 10) / 10;
}

export function classifyIntegrityResult(score: number, criticalCount: number): "pass" | "warn" | "fail" {
  if (criticalCount > 0) return "fail";
  if (score < 90) return "warn";
  return "pass";
}
