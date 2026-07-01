import type {
  ReliabilitySubsystemId,
  SubsystemRecoveryCapabilities,
} from "./reliabilityTypes.js";

/**
 * Auto-recovery framework (design only).
 * Subsystems declare capabilities; no recovery actions are implemented in Phase 1.6.
 */
export type RecoveryCapabilityKey =
  | "canRetry"
  | "canRestart"
  | "canRequeue"
  | "needsHumanReview"
  | "safeAutomaticRecovery";

export type RecoveryFrameworkDeclaration = SubsystemRecoveryCapabilities;

export function declareSubsystemRecoveryCapabilities(
  input: RecoveryFrameworkDeclaration,
): SubsystemRecoveryCapabilities {
  return {
    subsystemId: input.subsystemId,
    canRetry: Boolean(input.canRetry),
    canRestart: Boolean(input.canRestart),
    canRequeue: Boolean(input.canRequeue),
    needsHumanReview: Boolean(input.needsHumanReview),
    safeAutomaticRecovery: Boolean(input.safeAutomaticRecovery),
    recoveryNotes: input.recoveryNotes ?? null,
  };
}

/**
 * Default recovery declaration for unimplemented subsystems.
 * All automatic recovery flags are false until explicitly enabled per subsystem.
 */
export function defaultRecoveryCapabilities(
  subsystemId: ReliabilitySubsystemId,
  overrides: Partial<Omit<SubsystemRecoveryCapabilities, "subsystemId">> = {},
): SubsystemRecoveryCapabilities {
  return declareSubsystemRecoveryCapabilities({
    subsystemId,
    canRetry: false,
    canRestart: false,
    canRequeue: false,
    needsHumanReview: true,
    safeAutomaticRecovery: false,
    recoveryNotes: "Recovery not implemented; human review required.",
    ...overrides,
  });
}

export function isRecoveryFrameworkDeclaration(
  value: unknown,
): value is SubsystemRecoveryCapabilities {
  if (!value || typeof value !== "object") return false;
  const caps = value as SubsystemRecoveryCapabilities;
  return (
    typeof caps.subsystemId === "string" &&
    typeof caps.canRetry === "boolean" &&
    typeof caps.canRestart === "boolean" &&
    typeof caps.canRequeue === "boolean" &&
    typeof caps.needsHumanReview === "boolean" &&
    typeof caps.safeAutomaticRecovery === "boolean"
  );
}

/**
 * Validates recovery design rule: safeAutomaticRecovery requires at least one action.
 */
export function validateRecoveryFrameworkDeclaration(
  caps: SubsystemRecoveryCapabilities,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (caps.safeAutomaticRecovery && !caps.canRetry && !caps.canRestart && !caps.canRequeue) {
    errors.push(
      "safeAutomaticRecovery requires canRetry, canRestart, or canRequeue to be true",
    );
  }
  return { valid: errors.length === 0, errors };
}
