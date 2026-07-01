import type { IntegrityWatchReport, IntegrityRunMode } from "./integrityTypes.js";
import { INTEGRITY_WATCH_VERSION } from "./integrityTypes.js";
import type { IntegrityOrgReport } from "./integrityTypes.js";
import { computeOverallIntegrityScore } from "./integrityScore.js";
import {
  listAllIntegrityCheckIds,
  listImplementedIntegrityCheckIds,
} from "./integrityRegistry.js";
import { buildNoiseAnalytics, type IntegrityIgnoredRecord } from "./integrityNoiseAnalytics.js";
import { buildSignalQualityComparison } from "./integritySignalComparison.js";

export function buildIntegrityWatchReport(input: {
  mode: IntegrityRunMode;
  dryRun: boolean;
  organizationReports: IntegrityOrgReport[];
  generatedAt?: string;
  ignored?: IntegrityIgnoredRecord[];
  includeSignalComparison?: boolean;
}): IntegrityWatchReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const allFindings = input.organizationReports.flatMap((r) => r.findings);
  const failed = allFindings.filter((f) => f.status === "fail");
  const criticalFindings = failed.filter((f) => f.severity === "critical").length;
  const importantFindings = failed.filter((f) => f.severity === "important").length;
  const warningFindings = failed.filter((f) => f.severity === "warning").length;
  const infoFindings = failed.filter((f) => f.severity === "info").length;
  const noiseAnalytics = buildNoiseAnalytics(allFindings, input.ignored ?? []);

  const report: IntegrityWatchReport = {
    schemaVersion: INTEGRITY_WATCH_VERSION,
    generatedAt,
    mode: input.mode,
    dryRun: input.dryRun,
    organizationsScanned: input.organizationReports.length,
    overallIntegrityScore: computeOverallIntegrityScore(input.organizationReports),
    criticalFindings,
    importantFindings,
    warningFindings,
    infoFindings,
    organizationReports: input.organizationReports,
    checksRun: listImplementedIntegrityCheckIds().length,
    checksImplemented: listImplementedIntegrityCheckIds().length,
    passed: criticalFindings === 0,
    noiseAnalytics,
    signalQualityComparison: null,
  };

  if (input.includeSignalComparison !== false) {
    report.signalQualityComparison = buildSignalQualityComparison(report);
  }

  return report;
}

export function formatIntegrityWatchReport(report: IntegrityWatchReport): string {
  const lines = [
    `Data Integrity Watch (${report.schemaVersion})`,
    `Mode: ${report.mode} | Dry run: ${report.dryRun}`,
    `Organizations: ${report.organizationsScanned}`,
    `Overall score: ${report.overallIntegrityScore}`,
    `Critical: ${report.criticalFindings} | Important: ${report.importantFindings} | Warnings: ${report.warningFindings} | Info: ${report.infoFindings}`,
    `Ignored (noise suppressed): ${report.noiseAnalytics.ignoredCount}`,
    `Checks implemented: ${report.checksImplemented} / ${listAllIntegrityCheckIds().length}`,
    `Passed: ${report.passed ? "yes" : "no"}`,
  ];

  if (report.signalQualityComparison) {
    const cmp = report.signalQualityComparison;
    lines.push(
      `Signal quality: critical -${cmp.criticalCountReduction}, warnings +${cmp.warningIncrease}, info +${cmp.infoIncrease}`,
    );
  }

  return lines.join("\n");
}
