import type { TrustDashboardSnapshot, TrustScore } from "./trustTypes.js";
import { TRUST_ARCHITECTURE_VERSION } from "./trustTypes.js";

export type TrustDashboardInput = {
  trustScore: TrustScore;
  criticalRisks?: string[];
  businessRuleFailures?: number;
  recentAiOverrides?: number;
  goldenFailures?: number;
  journeyFailures?: number;
  integrityFindings?: number;
  auditorFindings?: number;
  dependencyFailures?: number;
  pendingManualReviews?: number;
  generatedAt?: string;
};

export function buildTrustDashboardSnapshot(input: TrustDashboardInput): TrustDashboardSnapshot {
  const blocked =
    input.trustScore.criticalFailures > 0 ||
    (input.goldenFailures ?? 0) > 0 ||
    (input.journeyFailures ?? 0) > 0 ||
    (input.businessRuleFailures ?? 0) > 0;

  const notReady = input.trustScore.score < 90 || (input.pendingManualReviews ?? 0) > 10;

  return {
    schemaVersion: TRUST_ARCHITECTURE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    trustScore: input.trustScore.score,
    criticalRisks: input.criticalRisks ?? [],
    businessRuleFailures: input.businessRuleFailures ?? 0,
    recentAiOverrides: input.recentAiOverrides ?? 0,
    goldenFailures: input.goldenFailures ?? 0,
    journeyFailures: input.journeyFailures ?? 0,
    integrityFindings: input.integrityFindings ?? 0,
    auditorFindings: input.auditorFindings ?? 0,
    dependencyFailures: input.dependencyFailures ?? 0,
    pendingManualReviews: input.pendingManualReviews ?? 0,
    releaseReadiness: blocked ? "blocked" : notReady ? "not_ready" : "ready",
  };
}

export const TRUST_DASHBOARD_PANELS = [
  "current_trust_score",
  "critical_risks",
  "business_rule_failures",
  "recent_ai_overrides",
  "golden_failures",
  "journey_failures",
  "integrity_findings",
  "auditor_findings",
  "dependency_failures",
  "pending_manual_reviews",
  "release_readiness",
] as const;

export function formatTrustDashboardSummary(snapshot: TrustDashboardSnapshot): string {
  return [
    `Trust Score: ${snapshot.trustScore}`,
    `Release readiness: ${snapshot.releaseReadiness}`,
    `Golden failures: ${snapshot.goldenFailures}`,
    `Journey failures: ${snapshot.journeyFailures}`,
    `Business rule failures: ${snapshot.businessRuleFailures}`,
    `Pending reviews: ${snapshot.pendingManualReviews}`,
  ].join(" | ");
}
