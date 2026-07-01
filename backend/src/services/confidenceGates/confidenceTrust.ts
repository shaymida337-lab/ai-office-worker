import type { ConfidenceResult } from "./confidenceTypes.js";

export type ConfidenceTrustContribution = {
  contributesToTrustScore: boolean;
  contributesToDecisionEvidence: boolean;
  decision: ConfidenceResult["decision"];
  confidenceScore: number;
  evidenceCount: number;
};

export function buildConfidenceTrustContribution(result: ConfidenceResult): ConfidenceTrustContribution {
  return {
    contributesToTrustScore: result.decision !== "BLOCKED",
    contributesToDecisionEvidence: true,
    decision: result.decision,
    confidenceScore: result.confidenceScore,
    evidenceCount: result.supportingEvidence.filter((item) => item.present).length,
  };
}

export function confidenceResultForDecisionEvidence(result: ConfidenceResult) {
  return {
    decision: result.decision,
    confidenceScore: result.confidenceScore,
    confidenceLevel: result.confidenceLevel,
    explanation: result.explanation,
    supportingEvidence: result.supportingEvidence,
    missingEvidence: result.missingEvidence,
    blockingReasons: result.blockingReasons,
    recommendedAction: result.recommendedAction,
    thresholds: result.thresholds,
    evaluatedAt: result.evaluatedAt,
  };
}
