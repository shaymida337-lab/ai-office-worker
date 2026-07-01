import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";
import type { ConfidenceResult } from "./confidenceTypes.js";

const emittedKeys = new Set<string>();

export function emitConfidenceReliabilityEvent(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  result: ConfidenceResult;
  correlationId: string | null;
}): ReliabilityEvent | null {
  if (input.result.decision === "AUTO_EXECUTE") return null;

  const dedupeKey = `${input.organizationId}:${input.entityType}:${input.entityId}:${input.result.decision}`;
  if (emittedKeys.has(dedupeKey)) return null;
  emittedKeys.add(dedupeKey);

  const severity =
    input.result.decision === "BLOCKED" &&
    input.result.blockingReasons.some((reason) =>
      ["cross_organization_violation", "integrity_critical", "permission_denied"].includes(reason),
    )
      ? "CRITICAL"
      : "IMPORTANT";

  const probableRootCause =
    input.result.decision === "BLOCKED"
      ? input.result.blockingReasons[0] ?? "confidence_blocked"
      : input.result.blockingReasons[0] ?? "low_confidence";

  return buildReliabilityEvent({
    subsystem: "payments",
    stage: "confidence_gate",
    severity,
    organizationId: input.organizationId,
    entityId: input.entityId,
    correlationId: input.correlationId ?? dedupeKey,
    probableRootCause,
    suggestedAction: input.result.recommendedAction,
    autoRecoverable: input.result.decision === "REVIEW_REQUIRED",
    message: input.result.explanation,
  });
}

export function resetConfidenceReliabilityDedupeForTests(): void {
  emittedKeys.clear();
}
