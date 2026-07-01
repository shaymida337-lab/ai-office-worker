import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import type { ReleaseCertificate } from "./certificateTypes.js";

const emittedKeys = new Set<string>();

export function emitReleaseCertificateReliabilityEvent(input: {
  organizationId: string;
  certificate: ReleaseCertificate;
}): ReliabilityEvent | null {
  const dedupeKey = `${input.organizationId}:${input.certificate.certificateId}:${input.certificate.overallStatus}`;
  if (emittedKeys.has(dedupeKey)) return null;
  emittedKeys.add(dedupeKey);

  const severity =
    input.certificate.overallStatus === "RED"
      ? "CRITICAL"
      : input.certificate.overallStatus === "YELLOW"
        ? "IMPORTANT"
        : "INFO";

  return buildReliabilityEvent({
    subsystem: "payments",
    stage: "release_certificate",
    severity,
    organizationId: input.organizationId,
    entityId: input.certificate.certificateId,
    correlationId: input.certificate.certificateId,
    probableRootCause:
      input.certificate.failedGates[0] ?? input.certificate.warningGates[0] ?? "release_evaluation",
    suggestedAction: input.certificate.releaseRecommendation,
    autoRecoverable: input.certificate.overallStatus === "YELLOW",
    message:
      input.certificate.overallStatus === "GREEN"
        ? "Release certificate generated — GREEN"
        : input.certificate.explanation,
  });
}

export function resetReleaseCertificateReliabilityDedupeForTests(): void {
  emittedKeys.clear();
}
