import type { ShadowModeSubsystem } from "./hardeningTypes.js";
import { SHADOW_MODE_SUBSYSTEMS } from "./hardeningTypes.js";

export type ShadowComparisonResult = {
  subsystem: ShadowModeSubsystem;
  oldPathOutput: unknown;
  newPathOutput: unknown;
  fieldsChanged: string[];
  promotionAllowed: boolean;
  stableRunCount: number;
  requiredStableRuns: number;
  explanation: string;
};

export type ShadowModeConfig = {
  subsystem: ShadowModeSubsystem;
  enabled: boolean;
  oldPathIsSourceOfTruth: true;
  requiredStableRunsBeforePromotion: number;
  compareFields: string[];
};

export const DEFAULT_SHADOW_CONFIGS: readonly ShadowModeConfig[] = SHADOW_MODE_SUBSYSTEMS.map(
  (subsystem) => ({
    subsystem,
    enabled: false,
    oldPathIsSourceOfTruth: true as const,
    requiredStableRunsBeforePromotion: 100,
    compareFields: defaultCompareFields(subsystem),
  }),
);

function defaultCompareFields(subsystem: ShadowModeSubsystem): string[] {
  switch (subsystem) {
    case "ai_extraction":
      return ["amount", "supplier", "documentType", "confidenceScore"];
    case "amount_parser":
      return ["amount", "currency"];
    case "supplier_detection":
      return ["supplierName", "vatNumber"];
    case "deduplication":
      return ["fingerprint", "isDuplicate"];
    case "outcome_engine":
      return ["outcomeStatus", "persistenceAction"];
    case "whatsapp_ingestion":
      return ["documentType", "channel"];
    case "payment_creation":
      return ["amount", "supplier", "persistenceAction"];
    default:
      return [];
  }
}

export function compareShadowOutputs(input: {
  subsystem: ShadowModeSubsystem;
  oldPathOutput: Record<string, unknown>;
  newPathOutput: Record<string, unknown>;
  stableRunCount: number;
  requiredStableRuns?: number;
}): ShadowComparisonResult {
  const config = DEFAULT_SHADOW_CONFIGS.find((c) => c.subsystem === input.subsystem);
  const compareFields = config?.compareFields ?? [];
  const fieldsChanged = compareFields.filter(
    (f) => input.oldPathOutput[f] !== input.newPathOutput[f],
  );
  const required = input.requiredStableRuns ?? config?.requiredStableRunsBeforePromotion ?? 100;
  const promotionAllowed = fieldsChanged.length === 0 && input.stableRunCount >= required;

  return {
    subsystem: input.subsystem,
    oldPathOutput: input.oldPathOutput,
    newPathOutput: input.newPathOutput,
    fieldsChanged,
    promotionAllowed,
    stableRunCount: input.stableRunCount,
    requiredStableRuns: required,
    explanation: promotionAllowed
      ? "Shadow outputs stable — promotion eligible"
      : fieldsChanged.length > 0
        ? `Mismatch on: ${fieldsChanged.join(", ")}`
        : `Need ${required - input.stableRunCount} more stable runs`,
  };
}

export function listShadowModeSubsystems(): ShadowModeSubsystem[] {
  return [...SHADOW_MODE_SUBSYSTEMS];
}
