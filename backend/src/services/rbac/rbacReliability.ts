import { buildReliabilityEvent } from "../reliability/reliabilityEventModel.js";
import type { ReliabilityEvent } from "../reliability/reliabilityTypes.js";

const emittedKeys = new Set<string>();

export function emitPermissionDeniedReliability(input: {
  organizationId: string;
  userId: string;
  permission: string;
  role: string | null;
  reason: string;
}): ReliabilityEvent | null {
  const dedupeKey = `${input.organizationId}:${input.userId}:${input.permission}`;
  if (emittedKeys.has(dedupeKey)) return null;
  emittedKeys.add(dedupeKey);

  return buildReliabilityEvent({
    subsystem: "payments",
    stage: "rbac_denied",
    severity: "IMPORTANT",
    organizationId: input.organizationId,
    entityId: input.userId,
    correlationId: dedupeKey,
    probableRootCause: "permission_denied",
    suggestedAction: `Grant ${input.permission} to role ${input.role ?? "unknown"} or use an authorized account`,
    autoRecoverable: false,
    message: input.reason,
  });
}

export function resetRbacReliabilityDedupeForTests(): void {
  emittedKeys.clear();
}
