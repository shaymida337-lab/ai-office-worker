import { evaluateTrustRules, weightedConfidence } from "./trustRules.js";
import type { TrustDecision, TrustEngineInput } from "./trustTypes.js";
import { TE_VERSION } from "./trustTypes.js";

const AUTO_SAVE_CONFIDENCE_THRESHOLD = 82;
const STRONG_AGREEMENT_AUTO_SAVE_THRESHOLD = 75;

function coreFinancialEnginesClear(input: TrustEngineInput): boolean {
  if (input.context?.duplicateRisk === "high") return false;
  return (
    input.moneyDecision.status === "resolved" &&
    input.supplierDecision.status === "resolved" &&
    input.fseDecision.overallStatus === "valid"
  );
}

function buildExplanation(input: {
  decision: TrustDecision["decision"];
  confidence: number;
  strongAgreement: boolean;
  uncertaintyCount: number;
  reasonCode: string;
}): string {
  if (input.decision === "BLOCK") {
    return "Trust Engine blocked automatic action because FSE reported a critical financial sanity error.";
  }
  if (input.decision === "NEEDS_REVIEW") {
    if (input.reasonCode === "TE_UPSTREAM_REVIEW") {
      return "At least one upstream engine requested manual review before Natalie can act automatically.";
    }
    return `Confidence is ${input.confidence}% with ${input.uncertaintyCount} uncertainty signal(s); manual review is required.`;
  }
  if (input.strongAgreement) {
    return `All upstream engines strongly agree. Confidence ${input.confidence}% is sufficient for automatic action.`;
  }
  return `Confidence ${input.confidence}% cleared the automatic action threshold without blocking review signals.`;
}

function buildReason(decision: TrustDecision["decision"], reasonCode: string): string {
  switch (reasonCode) {
    case "TE_FSE_CRITICAL_ERROR":
      return "Blocked by FSE critical failure";
    case "TE_UPSTREAM_REVIEW":
      return "Upstream engine requested review";
    case "TE_STRONG_AGREEMENT":
      return "Strong agreement across engines";
    case "TE_NEVER_GUESS_UNCERTAINTY":
      return "Uncertainty signals require review";
    case "TE_LOW_CONFIDENCE":
      return "Confidence below automatic action threshold";
    case "TE_AUTO_SAVE":
      return "Sufficient trust for automatic action";
    default:
      return decision === "AUTO_SAVE" ? "Automatic action allowed" : "Manual review required";
  }
}

export function summarizeTrustDecision(decision: TrustDecision) {
  return {
    version: decision.version,
    confidence: decision.confidence,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    contributors: decision.contributors.map(({ engine, score, weight, impact, explanation }) => ({
      engine,
      score,
      weight,
      impact,
      explanation,
    })),
  };
}

export function computeTrustDecision(input: TrustEngineInput): TrustDecision {
  const evaluation = evaluateTrustRules(input);
  const confidence = weightedConfidence(evaluation.contributors);

  if (evaluation.criticalFailure) {
    return {
      version: TE_VERSION,
      confidence,
      decision: "BLOCK",
      reason: buildReason("BLOCK", "TE_FSE_CRITICAL_ERROR"),
      reasonCode: "TE_FSE_CRITICAL_ERROR",
      explanation: buildExplanation({
        decision: "BLOCK",
        confidence,
        strongAgreement: evaluation.strongAgreement,
        uncertaintyCount: evaluation.uncertaintyFlags.length,
        reasonCode: "TE_FSE_CRITICAL_ERROR",
      }),
      contributors: evaluation.contributors,
    };
  }

  if (coreFinancialEnginesClear(input)) {
    return {
      version: TE_VERSION,
      confidence,
      decision: "AUTO_SAVE",
      reason: buildReason("AUTO_SAVE", "TE_AUTO_SAVE"),
      reasonCode: "TE_AUTO_SAVE",
      explanation: buildExplanation({
        decision: "AUTO_SAVE",
        confidence,
        strongAgreement: evaluation.strongAgreement,
        uncertaintyCount: evaluation.uncertaintyFlags.length,
        reasonCode: "TE_AUTO_SAVE",
      }),
      contributors: evaluation.contributors,
    };
  }

  if (evaluation.requestsReview) {
    return {
      version: TE_VERSION,
      confidence,
      decision: "NEEDS_REVIEW",
      reason: buildReason("NEEDS_REVIEW", "TE_UPSTREAM_REVIEW"),
      reasonCode: "TE_UPSTREAM_REVIEW",
      explanation: buildExplanation({
        decision: "NEEDS_REVIEW",
        confidence,
        strongAgreement: evaluation.strongAgreement,
        uncertaintyCount: evaluation.uncertaintyFlags.length,
        reasonCode: "TE_UPSTREAM_REVIEW",
      }),
      contributors: evaluation.contributors,
    };
  }

  if (evaluation.strongAgreement && confidence >= STRONG_AGREEMENT_AUTO_SAVE_THRESHOLD) {
    return {
      version: TE_VERSION,
      confidence,
      decision: "AUTO_SAVE",
      reason: buildReason("AUTO_SAVE", "TE_STRONG_AGREEMENT"),
      reasonCode: "TE_STRONG_AGREEMENT",
      explanation: buildExplanation({
        decision: "AUTO_SAVE",
        confidence,
        strongAgreement: true,
        uncertaintyCount: evaluation.uncertaintyFlags.length,
        reasonCode: "TE_STRONG_AGREEMENT",
      }),
      contributors: evaluation.contributors,
    };
  }

  if (evaluation.uncertaintyFlags.length > 0 && confidence < AUTO_SAVE_CONFIDENCE_THRESHOLD) {
    return {
      version: TE_VERSION,
      confidence,
      decision: "NEEDS_REVIEW",
      reason: buildReason("NEEDS_REVIEW", "TE_NEVER_GUESS_UNCERTAINTY"),
      reasonCode: "TE_NEVER_GUESS_UNCERTAINTY",
      explanation: buildExplanation({
        decision: "NEEDS_REVIEW",
        confidence,
        strongAgreement: evaluation.strongAgreement,
        uncertaintyCount: evaluation.uncertaintyFlags.length,
        reasonCode: "TE_NEVER_GUESS_UNCERTAINTY",
      }),
      contributors: evaluation.contributors,
    };
  }

  if (confidence >= AUTO_SAVE_CONFIDENCE_THRESHOLD) {
    return {
      version: TE_VERSION,
      confidence,
      decision: "AUTO_SAVE",
      reason: buildReason("AUTO_SAVE", "TE_AUTO_SAVE"),
      reasonCode: "TE_AUTO_SAVE",
      explanation: buildExplanation({
        decision: "AUTO_SAVE",
        confidence,
        strongAgreement: evaluation.strongAgreement,
        uncertaintyCount: evaluation.uncertaintyFlags.length,
        reasonCode: "TE_AUTO_SAVE",
      }),
      contributors: evaluation.contributors,
    };
  }

  return {
    version: TE_VERSION,
    confidence,
    decision: "NEEDS_REVIEW",
    reason: buildReason("NEEDS_REVIEW", "TE_LOW_CONFIDENCE"),
    reasonCode: "TE_LOW_CONFIDENCE",
    explanation: buildExplanation({
      decision: "NEEDS_REVIEW",
      confidence,
      strongAgreement: evaluation.strongAgreement,
      uncertaintyCount: evaluation.uncertaintyFlags.length,
      reasonCode: "TE_LOW_CONFIDENCE",
    }),
    contributors: evaluation.contributors,
  };
}
