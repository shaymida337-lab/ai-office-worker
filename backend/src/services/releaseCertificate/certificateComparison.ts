import type { ReleaseCertificate, ReleaseCertificateComparison, ReleaseGateName } from "./certificateTypes.js";

export function compareReleaseCertificates(
  baseline: ReleaseCertificate,
  current: ReleaseCertificate,
): ReleaseCertificateComparison {
  const baselineFailed = new Set(baseline.failedGates);
  const currentFailed = new Set(current.failedGates);
  const baselineWarnings = new Set(baseline.warningGates);
  const currentWarnings = new Set(current.warningGates);

  const newlyFailedGates = [...currentFailed].filter((gate) => !baselineFailed.has(gate));
  const newlyWarningGates = [...currentWarnings].filter((gate) => !baselineWarnings.has(gate));
  const resolvedGates = [...baselineFailed, ...baselineWarnings].filter(
    (gate) => !currentFailed.has(gate) && !currentWarnings.has(gate),
  ) as ReleaseGateName[];

  const statusChanged = baseline.overallStatus !== current.overallStatus;
  const scoreDelta = Math.round((current.overallScore - baseline.overallScore) * 10) / 10;

  const explanationParts: string[] = [];
  if (statusChanged) {
    explanationParts.push(`Status changed ${baseline.overallStatus} → ${current.overallStatus}`);
  }
  if (newlyFailedGates.length > 0) explanationParts.push(`New failures: ${newlyFailedGates.join(", ")}`);
  if (resolvedGates.length > 0) explanationParts.push(`Resolved: ${resolvedGates.join(", ")}`);
  if (explanationParts.length === 0) explanationParts.push("No material gate changes between releases");

  return {
    baselineCertificateId: baseline.certificateId,
    currentCertificateId: current.certificateId,
    statusChanged,
    scoreDelta,
    newlyFailedGates,
    newlyWarningGates,
    resolvedGates,
    explanation: explanationParts.join("; "),
  };
}
