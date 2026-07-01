import type { CanaryStage } from "./hardeningTypes.js";
import { CANARY_STAGES } from "./hardeningTypes.js";

export type CanaryGateCheck = {
  name: string;
  required: boolean;
  status: "pass" | "warn" | "fail" | "not_run";
};

export type CanaryStageDefinition = {
  stage: CanaryStage;
  label: string;
  organizationCount: number;
  requiredGates: string[];
};

export const CANARY_STAGE_DEFINITIONS: readonly CanaryStageDefinition[] = [
  { stage: "internal_org", label: "Internal org only", organizationCount: 1, requiredGates: allGates() },
  { stage: "test_org", label: "Test org", organizationCount: 1, requiredGates: allGates() },
  { stage: "pilot_1", label: "1 pilot customer", organizationCount: 1, requiredGates: allGates() },
  { stage: "pilot_5", label: "5 pilot customers", organizationCount: 5, requiredGates: allGates() },
  { stage: "pilot_20", label: "20 pilot customers", organizationCount: 20, requiredGates: allGates() },
  { stage: "full_rollout", label: "Full rollout", organizationCount: -1, requiredGates: allGates() },
];

function allGates(): string[] {
  return [
    "health_green",
    "golden_tests_green",
    "journey_tests_green",
    "data_integrity_green",
    "no_critical_alerts",
  ];
}

export function evaluateCanaryPromotion(input: {
  currentStage: CanaryStage;
  gates: CanaryGateCheck[];
}): { canPromote: boolean; nextStage: CanaryStage | null; blockers: string[] } {
  const blockers = input.gates
    .filter((g) => g.required && (g.status === "fail" || g.status === "not_run"))
    .map((g) => `${g.name}: ${g.status}`);

  const currentIndex = CANARY_STAGES.indexOf(input.currentStage);
  const nextStage = currentIndex < CANARY_STAGES.length - 1 ? CANARY_STAGES[currentIndex + 1] : null;

  return {
    canPromote: blockers.length === 0 && nextStage != null,
    nextStage,
    blockers,
  };
}

export function listCanaryStages(): CanaryStage[] {
  return [...CANARY_STAGES];
}
