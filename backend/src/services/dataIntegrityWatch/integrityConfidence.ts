import type { IntegrityFinding } from "./integrityTypes.js";

export function computeFindingConfidence(input: {
  baseConfidence: number;
  signalCount: number;
  crossValidated?: boolean;
  historicalEvidence?: boolean;
}): number {
  let confidence = input.baseConfidence;
  if (input.signalCount >= 2) confidence += 0.05;
  if (input.signalCount >= 3) confidence += 0.05;
  if (input.crossValidated) confidence += 0.08;
  if (input.historicalEvidence) confidence -= 0.1;
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;
}

export function withFindingConfidence(
  finding: IntegrityFinding,
  confidence: number,
): IntegrityFinding {
  return { ...finding, findingConfidence: confidence };
}
