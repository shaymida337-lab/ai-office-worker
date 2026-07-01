import type { AuditorConfig, ComparisonReport } from "./auditorTypes.js";

/**
 * Confidence gate integration helper — advisory until auditor is enabled in org config.
 * When enabled and disagreement exceeds tolerance, auto-execute should be blocked.
 */
export function combineConfidenceWithAuditor(
  primaryConfidence: number | null,
  auditorConfidence: number,
  comparison: ComparisonReport,
  config: AuditorConfig,
): {
  combinedConfidence: number | null;
  autoExecuteBlockedByAuditor: boolean;
} {
  if (!config.enabled) {
    return { combinedConfidence: primaryConfidence, autoExecuteBlockedByAuditor: false };
  }

  const primary = primaryConfidence ?? 0;
  const combinedConfidence = Math.round(primary * auditorConfidence * 1000) / 1000;

  const hasCriticalDisagreement = comparison.differences.some((d) => d.severity === "critical");
  const exceedsTolerance =
    hasCriticalDisagreement ||
    comparison.amountMismatch ||
    comparison.duplicateMismatch ||
    comparison.classificationMismatch ||
    Math.abs(primary - auditorConfidence) > config.confidenceTolerance;

  return {
    combinedConfidence,
    autoExecuteBlockedByAuditor: exceedsTolerance,
  };
}
