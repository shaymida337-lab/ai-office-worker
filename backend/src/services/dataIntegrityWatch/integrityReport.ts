import type { IntegrityWatchReport, IntegrityRunMode } from "./integrityTypes.js";
import { INTEGRITY_WATCH_VERSION } from "./integrityTypes.js";
import type { IntegrityOrgReport } from "./integrityTypes.js";
import { computeOverallIntegrityScore } from "./integrityScore.js";
import {
  listAllIntegrityCheckIds,
  listImplementedIntegrityCheckIds,
} from "./integrityRegistry.js";

export function buildIntegrityWatchReport(input: {
  mode: IntegrityRunMode;
  dryRun: boolean;
  organizationReports: IntegrityOrgReport[];
  generatedAt?: string;
}): IntegrityWatchReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const allFindings = input.organizationReports.flatMap((r) => r.findings);
  const failed = allFindings.filter((f) => f.status === "fail");
  const criticalFindings = failed.filter((f) => f.severity === "critical").length;
  const warningFindings = failed.filter((f) => f.severity === "warning").length;
  const infoFindings = failed.filter((f) => f.severity === "info").length;

  return {
    schemaVersion: INTEGRITY_WATCH_VERSION,
    generatedAt,
    mode: input.mode,
    dryRun: input.dryRun,
    organizationsScanned: input.organizationReports.length,
    overallIntegrityScore: computeOverallIntegrityScore(input.organizationReports),
    criticalFindings,
    warningFindings,
    infoFindings,
    organizationReports: input.organizationReports,
    checksRun: listImplementedIntegrityCheckIds().length,
    checksImplemented: listImplementedIntegrityCheckIds().length,
    passed: criticalFindings === 0,
  };
}

export function formatIntegrityWatchReport(report: IntegrityWatchReport): string {
  return [
    `Data Integrity Watch (${report.schemaVersion})`,
    `Mode: ${report.mode} | Dry run: ${report.dryRun}`,
    `Organizations: ${report.organizationsScanned}`,
    `Overall score: ${report.overallIntegrityScore}`,
    `Critical: ${report.criticalFindings} | Warnings: ${report.warningFindings} | Info: ${report.infoFindings}`,
    `Checks implemented: ${report.checksImplemented} / ${listAllIntegrityCheckIds().length}`,
    `Passed: ${report.passed ? "yes" : "no"}`,
  ].join("\n");
}
