import type { IntegrityWatchReport } from "./integrityTypes.js";
import { classifyIntegrityResult } from "./integrityScore.js";

export function integrityResultForTrustCertificate(
  report: IntegrityWatchReport,
): "pass" | "warn" | "fail" {
  return classifyIntegrityResult(report.overallIntegrityScore, report.criticalFindings);
}

export function integrityResultForGoldenReporting(
  report: IntegrityWatchReport,
): { aligned: boolean; criticalFindings: number; note: string } {
  return {
    aligned: report.criticalFindings === 0,
    criticalFindings: report.criticalFindings,
    note:
      report.criticalFindings === 0
        ? "Integrity watch aligned with golden suite expectations"
        : `${report.criticalFindings} critical integrity findings may correlate with golden regressions`,
  };
}

export function integrityContributionToTrustScore(report: IntegrityWatchReport): {
  input: "integrity_watch";
  score: number;
  status: "pass" | "warn" | "fail";
} {
  const status = integrityResultForTrustCertificate(report);
  return {
    input: "integrity_watch",
    score: report.overallIntegrityScore,
    status,
  };
}
