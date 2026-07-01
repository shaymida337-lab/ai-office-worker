import { randomUUID } from "node:crypto";

import { config } from "../../lib/config.js";
import type {
  ReleaseCertificate,
  ReleaseCertificateGenerateContext,
  ReleaseCertificateStatus,
  ReleaseGateName,
  ReleaseGateResult,
} from "./certificateTypes.js";
import { DEFAULT_RELEASE_CERTIFICATE_CONFIG, GATE_WEIGHTS } from "./certificateConfig.js";
import { deriveTrustScoreFromGates } from "./gateEvaluator.js";
import { collectReleaseGateResults } from "./gateCollectors.js";

export function evaluateReleaseCertificate(
  gateResults: ReleaseGateResult[],
  context: ReleaseCertificateGenerateContext,
  certificateId = `rc_${randomUUID()}`,
): ReleaseCertificate {
  const failedGates = gateResults.filter((g) => g.status === "fail").map((g) => g.name);
  const warningGates = gateResults.filter((g) => g.status === "warn").map((g) => g.name);
  const criticalFailures = gateResults.filter((g) => g.critical && g.status === "fail");

  const trustScore = deriveTrustScoreFromGates(gateResults);
  const overallScore = computeWeightedScore(gateResults);
  const overallStatus = deriveOverallStatus({
    failedGates,
    warningGates,
    criticalFailures: criticalFailures.map((g) => g.name),
    trustScore,
  });

  const releaseRecommendation = recommendationForStatus(overallStatus);
  const explanation = buildExplanation(overallStatus, failedGates, warningGates, trustScore);

  return {
    certificateId,
    timestamp: new Date().toISOString(),
    commitHash: context.commitHash ?? process.env.RELEASE_COMMIT_HASH ?? process.env.GIT_COMMIT ?? null,
    deployId: context.deployId ?? process.env.RELEASE_DEPLOY_ID ?? null,
    environment: context.environment ?? config.nodeEnv ?? "development",
    overallStatus,
    overallScore,
    gateResults,
    failedGates,
    warningGates,
    releaseRecommendation,
    explanation,
    trustScore,
  };
}

export async function generateReleaseCertificate(
  context: ReleaseCertificateGenerateContext,
): Promise<ReleaseCertificate> {
  const gateResults = await collectReleaseGateResults(context);
  return evaluateReleaseCertificate(gateResults, context);
}

function computeWeightedScore(gates: ReleaseGateResult[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const gate of gates) {
    const weight = GATE_WEIGHTS[gate.name] ?? 1;
    weighted += gate.score * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round((weighted / totalWeight) * 10) / 10 : 0;
}

function deriveOverallStatus(input: {
  failedGates: ReleaseGateName[];
  warningGates: ReleaseGateName[];
  criticalFailures: ReleaseGateName[];
  trustScore: number;
}): ReleaseCertificateStatus {
  if (
    input.criticalFailures.length > 0 ||
    input.failedGates.length > 0 ||
    input.trustScore < DEFAULT_RELEASE_CERTIFICATE_CONFIG.trustScoreMin
  ) {
    return "RED";
  }
  if (input.warningGates.length > 0) {
    return "YELLOW";
  }
  return "GREEN";
}

function recommendationForStatus(status: ReleaseCertificateStatus): string {
  switch (status) {
    case "GREEN":
      return "Ready for production. All required gates passed.";
    case "YELLOW":
      return "Deploy allowed only with explicit operator approval.";
    case "RED":
      return "Deployment blocked. Resolve failed gates before rollout.";
  }
}

function buildExplanation(
  status: ReleaseCertificateStatus,
  failedGates: ReleaseGateName[],
  warningGates: ReleaseGateName[],
  trustScore: number,
): string {
  if (status === "GREEN") {
    return `All release gates passed. Trust score ${trustScore}.`;
  }
  const parts: string[] = [];
  if (failedGates.length > 0) parts.push(`Failed gates: ${failedGates.join(", ")}`);
  if (warningGates.length > 0) parts.push(`Warning gates: ${warningGates.join(", ")}`);
  if (trustScore < DEFAULT_RELEASE_CERTIFICATE_CONFIG.trustScoreMin) {
    parts.push(`Trust score ${trustScore} below ${DEFAULT_RELEASE_CERTIFICATE_CONFIG.trustScoreMin}`);
  }
  return parts.join("; ") || "Release certificate evaluation completed";
}
