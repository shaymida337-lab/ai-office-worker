import type { AiSelfVerificationCapability, AiSelfVerificationPlaceholder } from "./trustTypes.js";
import { AI_SELF_VERIFICATION_CAPABILITIES } from "./trustTypes.js";

export const AI_SELF_VERIFICATION_PLACEHOLDERS: readonly AiSelfVerificationPlaceholder[] = [
  placeholder(
    "ai_cross_checking_ai",
    "Second AI model cross-validates extraction and decision outputs before persistence",
    true,
  ),
  placeholder(
    "automatic_anomaly_explanation",
    "AI generates human-readable explanation when anomaly or drift detected",
    false,
  ),
  placeholder(
    "self_diagnosis",
    "System identifies root cause of failures from reliability event patterns",
    false,
  ),
  placeholder(
    "recommendation_engine",
    "Suggests operator actions based on integrity findings and audit history",
    true,
  ),
  placeholder(
    "safe_self_healing",
    "Automated recovery limited to allowed operations from recovery engine catalog",
    true,
  ),
  placeholder(
    "human_approval_workflow",
    "All financial mutations requiring self-healing route through explicit human approval",
    true,
  ),
];

function placeholder(
  capability: AiSelfVerificationCapability,
  description: string,
  requiresHumanApproval: boolean,
): AiSelfVerificationPlaceholder {
  return { capability, status: "design_only", description, requiresHumanApproval };
}

export function listAiSelfVerificationCapabilities(): AiSelfVerificationCapability[] {
  return [...AI_SELF_VERIFICATION_CAPABILITIES];
}

export function getAiSelfVerificationPlaceholder(
  capability: AiSelfVerificationCapability,
): AiSelfVerificationPlaceholder | undefined {
  return AI_SELF_VERIFICATION_PLACEHOLDERS.find((p) => p.capability === capability);
}
