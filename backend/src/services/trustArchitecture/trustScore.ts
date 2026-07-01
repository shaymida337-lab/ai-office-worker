import type { TrustScore, TrustScoreComponent, TrustScoreInput } from "./trustTypes.js";
import { TRUST_ARCHITECTURE_VERSION, TRUST_SCORE_INPUTS } from "./trustTypes.js";

export const TRUST_SCORE_WEIGHTS: Readonly<Record<TrustScoreInput, number>> = {
  health: 8,
  golden_tests: 10,
  journey_tests: 10,
  ai_auditor: 8,
  integrity_watch: 10,
  permissions: 8,
  audit_log: 6,
  security: 10,
  dependencies: 6,
  recovery: 5,
  configuration: 6,
  performance: 4,
  business_rules: 9,
};

export type TrustScoreInputStatus = {
  input: TrustScoreInput;
  status: TrustScoreComponent["status"];
  score: number;
  critical?: boolean;
};

export function computeTrustScore(components: TrustScoreInputStatus[]): TrustScore {
  const enriched: TrustScoreComponent[] = components.map((c) => ({
    input: c.input,
    weight: TRUST_SCORE_WEIGHTS[c.input],
    score: c.score,
    status: c.status,
    critical: c.critical ?? isCriticalInput(c.input),
  }));

  const totalWeight = enriched.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = enriched.reduce((sum, c) => sum + c.score * c.weight, 0);
  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

  const criticalFailures = enriched.filter(
    (c) => c.critical && (c.status === "fail" || c.score < 60),
  ).length;

  return {
    schemaVersion: TRUST_ARCHITECTURE_VERSION,
    score: Math.min(100, Math.max(0, score)),
    components: enriched,
    criticalFailures,
    computedAt: new Date().toISOString(),
  };
}

function isCriticalInput(input: TrustScoreInput): boolean {
  return (
    input === "golden_tests" ||
    input === "journey_tests" ||
    input === "integrity_watch" ||
    input === "security" ||
    input === "permissions" ||
    input === "business_rules"
  );
}

export function statusToScore(status: TrustScoreComponent["status"]): number {
  switch (status) {
    case "pass":
      return 100;
    case "warn":
      return 75;
    case "fail":
      return 0;
    case "not_run":
      return 50;
    default:
      return 0;
  }
}

export function buildDefaultTrustScoreInputs(): TrustScoreInputStatus[] {
  return TRUST_SCORE_INPUTS.map((input) => ({
    input,
    status: "not_run" as const,
    score: 50,
  }));
}

export function isTrustScoreCertifiable(trustScore: TrustScore): boolean {
  return trustScore.criticalFailures === 0 && trustScore.score >= 90;
}

export function listTrustScoreInputs(): TrustScoreInput[] {
  return [...TRUST_SCORE_INPUTS];
}
