import type { IntegrityWatchReport, IntegritySignalQualityComparison } from "./integrityTypes.js";

/** Production baseline from Phase 2.3A.1 investigation (org cmqxujfuj034ndy2czu9tjoko). */
export const PROD_BASELINE_PRE_TUNING = {
  label: "phase-2.3a-pre-tuning",
  criticalFindings: 386,
  warningFindings: 0,
  infoFindings: 0,
  importantFindings: 0,
  ignoredOrphansEstimate: 0,
  topCriticalChecks: [
    { checkId: "scan-orphan-gmail-message", count: 383 },
    { checkId: "fin-payment-after-blocked", count: 2 },
    { checkId: "org-cross-org-reference", count: 1 },
  ],
} as const;

export function buildSignalQualityComparison(
  report: IntegrityWatchReport,
): IntegritySignalQualityComparison {
  const before = PROD_BASELINE_PRE_TUNING;
  const after = {
    criticalFindings: report.criticalFindings,
    warningFindings: report.warningFindings,
    infoFindings: report.infoFindings,
    importantFindings: report.importantFindings,
    ignoredCount: report.noiseAnalytics?.ignoredCount ?? 0,
  };

  const criticalReduction = before.criticalFindings - after.criticalFindings;
  const falsePositiveReductionEstimate = Math.max(0, criticalReduction);

  return {
    before,
    after,
    criticalCountReduction: criticalReduction,
    warningIncrease: after.warningFindings - before.warningFindings,
    infoIncrease: after.infoFindings - before.infoFindings,
    falsePositiveReductionEstimate,
    topRemainingRisks: report.noiseAnalytics.topNoisyValidators
      .filter((v) => v.checkId !== "scan-orphan-gmail-message" || v.count > 0)
      .slice(0, 5),
  };
}
