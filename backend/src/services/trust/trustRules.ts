import type { MoneyDecision } from "../amount/canonicalAmount.js";
import type { CanonicalFingerprintResult } from "../dedup/sharedMatcher.js";
import type { FinancialSanityDecision } from "../validation/sanityTypes.js";
import type { SupplierDecision } from "../supplier/supplierTypes.js";
import type {
  TrustContributor,
  TrustEngineInput,
  TrustOptionalContext,
  TrustRuleEvaluation,
} from "./trustTypes.js";

const ENGINE_WEIGHTS = {
  scfc: 0.15,
  arc: 0.25,
  sir: 0.25,
  fse: 0.3,
  context: 0.05,
} as const;

const STRONG_SCFC_TIERS = new Set(["file", "invoice-amount", "tax-invoice", "supplier-amount-date"]);

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreFromUnit(value: number): number {
  return clampConfidence(clampUnit(value) * 100);
}

function scfcBaseScore(fingerprint: CanonicalFingerprintResult | null): number {
  if (!fingerprint?.fingerprint) return 15;
  switch (fingerprint.tier) {
    case "file":
      return 98;
    case "tax-invoice":
      return 95;
    case "invoice-amount":
      return 92;
    case "supplier-amount-date":
      return 88;
    case "weak":
      return 52;
    case "none":
    default:
      return 28;
  }
}

export function evaluateScfcContributor(
  fingerprint: CanonicalFingerprintResult | null,
  context?: TrustOptionalContext
): { contributor: TrustContributor; uncertaintyFlags: string[]; requestsReview: boolean } {
  const uncertaintyFlags: string[] = [];
  const score = scfcBaseScore(fingerprint);
  let impact = 0;

  if (!fingerprint?.fingerprint) {
    uncertaintyFlags.push("scfc_missing_fingerprint");
    impact -= 12;
  } else if (!fingerprint.isStrongEnoughForAutoSaveDedup) {
    uncertaintyFlags.push("scfc_not_strong_enough_for_auto_save");
    impact -= 8;
  }

  if (fingerprint && !STRONG_SCFC_TIERS.has(fingerprint.tier)) {
    uncertaintyFlags.push(`scfc_tier_${fingerprint.tier}`);
  }

  if (context?.duplicateRisk === "high") {
    uncertaintyFlags.push("duplicate_risk_high");
    impact -= 10;
  } else if (context?.duplicateRisk === "medium") {
    uncertaintyFlags.push("duplicate_risk_medium");
    impact -= 5;
  }

  const requestsReview =
    !fingerprint?.fingerprint ||
    !fingerprint.isStrongEnoughForAutoSaveDedup ||
    context?.duplicateRisk === "high";

  return {
    contributor: {
      engine: "scfc",
      score,
      weight: ENGINE_WEIGHTS.scfc,
      impact,
      explanation: fingerprint?.fingerprint
        ? `Canonical fingerprint tier=${fingerprint.tier} strongEnough=${fingerprint.isStrongEnoughForAutoSaveDedup}`
        : "No canonical fingerprint available for dedup confidence",
    },
    uncertaintyFlags,
    requestsReview,
  };
}

export function evaluateArcContributor(moneyDecision: MoneyDecision): {
  contributor: TrustContributor;
  uncertaintyFlags: string[];
  requestsReview: boolean;
} {
  const uncertaintyFlags: string[] = [];
  const score = scoreFromUnit(moneyDecision.confidence);
  let impact = 0;

  if (moneyDecision.status === "ambiguous") {
    uncertaintyFlags.push("arc_ambiguous");
    impact -= 18;
  } else if (moneyDecision.status === "missing") {
    uncertaintyFlags.push("arc_missing");
    impact -= 22;
  } else if (moneyDecision.status === "rejected") {
    uncertaintyFlags.push("arc_rejected");
    impact -= 28;
  }

  if (!moneyDecision.isStrongEnoughForAutoSave) {
    uncertaintyFlags.push("arc_not_strong_enough_for_auto_save");
    impact -= 10;
  }

  for (const flag of moneyDecision.ambiguityFlags) {
    uncertaintyFlags.push(`arc_${flag}`);
  }

  const requestsReview = moneyDecision.status === "ambiguous" || moneyDecision.status === "missing";

  return {
    contributor: {
      engine: "arc",
      score,
      weight: ENGINE_WEIGHTS.arc,
      impact,
      explanation: `ARC status=${moneyDecision.status} reasonCode=${moneyDecision.reasonCode} confidence=${Math.round(moneyDecision.confidence * 100)}%`,
    },
    uncertaintyFlags,
    requestsReview,
  };
}

export function evaluateSirContributor(supplierDecision: SupplierDecision): {
  contributor: TrustContributor;
  uncertaintyFlags: string[];
  requestsReview: boolean;
} {
  const uncertaintyFlags: string[] = [];
  const score = scoreFromUnit(supplierDecision.confidence);
  let impact = 0;

  if (supplierDecision.status === "ambiguous") {
    uncertaintyFlags.push("sir_ambiguous");
    impact -= 18;
  } else if (supplierDecision.status === "missing") {
    uncertaintyFlags.push("sir_missing");
    impact -= 22;
  } else if (supplierDecision.status === "rejected") {
    uncertaintyFlags.push("sir_rejected");
    impact -= 28;
  }

  if (!supplierDecision.isStrongEnoughForAutoSave) {
    uncertaintyFlags.push("sir_not_strong_enough_for_auto_save");
    impact -= 10;
  }

  for (const flag of supplierDecision.ambiguityFlags) {
    uncertaintyFlags.push(`sir_${flag}`);
  }

  const requestsReview = supplierDecision.status === "ambiguous" || supplierDecision.status === "missing";

  return {
    contributor: {
      engine: "sir",
      score,
      weight: ENGINE_WEIGHTS.sir,
      impact,
      explanation: `SIR status=${supplierDecision.status} reasonCode=${supplierDecision.reasonCode} confidence=${Math.round(supplierDecision.confidence * 100)}%`,
    },
    uncertaintyFlags,
    requestsReview,
  };
}

export function evaluateFseContributor(fseDecision: FinancialSanityDecision): {
  contributor: TrustContributor;
  uncertaintyFlags: string[];
  requestsReview: boolean;
  criticalFailure: boolean;
} {
  const uncertaintyFlags: string[] = [];
  const score = clampConfidence(fseDecision.trustScore);
  let impact = 0;
  const criticalFailure = fseDecision.overallStatus === "error";

  if (fseDecision.overallStatus === "review") {
    uncertaintyFlags.push("fse_review");
    impact -= 14;
  } else if (fseDecision.overallStatus === "warning") {
    uncertaintyFlags.push("fse_warning");
    impact -= 8;
  } else if (criticalFailure) {
    uncertaintyFlags.push("fse_error");
    impact -= 35;
  }

  if (fseDecision.failedRules.length > 0) {
    uncertaintyFlags.push(`fse_failed_rules:${fseDecision.failedRules.join(",")}`);
  }

  const requestsReview = fseDecision.overallStatus === "review";

  return {
    contributor: {
      engine: "fse",
      score,
      weight: ENGINE_WEIGHTS.fse,
      impact,
      explanation: `FSE status=${fseDecision.overallStatus} trustScore=${fseDecision.trustScore} failed=${fseDecision.failedRules.join(",") || "none"}`,
    },
    uncertaintyFlags,
    requestsReview,
    criticalFailure,
  };
}

export function evaluateContextContributor(context?: TrustOptionalContext): {
  contributor: TrustContributor;
  uncertaintyFlags: string[];
} {
  const uncertaintyFlags: string[] = [];
  let score = 80;
  let impact = 0;

  if (context?.ocrQuality != null) {
    const ocrScore = scoreFromUnit(context.ocrQuality);
    score = Math.round((score + ocrScore) / 2);
    if (context.ocrQuality < 0.6) {
      uncertaintyFlags.push("ocr_quality_low");
      impact -= 8;
    }
  }

  if (context?.attachmentQuality != null) {
    const attachmentScore = scoreFromUnit(context.attachmentQuality);
    score = Math.round((score + attachmentScore) / 2);
    if (context.attachmentQuality < 0.5) {
      uncertaintyFlags.push("attachment_quality_low");
      impact -= 6;
    }
  }

  const historicalCorrections = context?.historicalCorrections ?? context?.supplierHistory?.correctionsCount ?? 0;
  if (historicalCorrections > 0) {
    const correctionPenalty = Math.min(20, historicalCorrections * 4);
    impact -= correctionPenalty;
    uncertaintyFlags.push(`historical_corrections_${historicalCorrections}`);
    score = clampConfidence(score - correctionPenalty);
  }

  if (context?.userCorrectionRate != null && context.userCorrectionRate > 0) {
    const ratePenalty = Math.round(context.userCorrectionRate * 15);
    impact -= ratePenalty;
    uncertaintyFlags.push(`user_correction_rate_${Math.round(context.userCorrectionRate * 100)}`);
    score = clampConfidence(score - ratePenalty);
  }

  const invoiceCount = context?.supplierHistory?.invoiceCount ?? 0;
  if (invoiceCount >= 3) {
    const historyBoost = Math.min(8, invoiceCount);
    impact += historyBoost;
    score = clampConfidence(score + historyBoost);
  }

  if (context?.previousConfidence != null) {
    const delta = context.previousConfidence - score;
    impact += Math.round(delta * 0.15);
  }

  return {
    contributor: {
      engine: "context",
      score: clampConfidence(score),
      weight: ENGINE_WEIGHTS.context,
      impact,
      explanation: "Optional learning and extraction-quality context",
    },
    uncertaintyFlags,
  };
}

export function detectStrongAgreement(input: TrustEngineInput): boolean {
  const fingerprint = input.fingerprint;
  const scfcStrong =
    Boolean(fingerprint?.fingerprint) &&
    fingerprint!.isStrongEnoughForAutoSaveDedup &&
    STRONG_SCFC_TIERS.has(fingerprint!.tier);
  const arcStrong =
    input.moneyDecision.status === "resolved" && input.moneyDecision.isStrongEnoughForAutoSave;
  const sirStrong =
    input.supplierDecision.status === "resolved" && input.supplierDecision.isStrongEnoughForAutoSave;
  const fseStrong = input.fseDecision.overallStatus === "valid";

  return scfcStrong && arcStrong && sirStrong && fseStrong;
}

export function evaluateTrustRules(input: TrustEngineInput): TrustRuleEvaluation {
  const scfc = evaluateScfcContributor(input.fingerprint, input.context);
  const arc = evaluateArcContributor(input.moneyDecision);
  const sir = evaluateSirContributor(input.supplierDecision);
  const fse = evaluateFseContributor(input.fseDecision);
  const context = evaluateContextContributor(input.context);

  const contributors = [scfc.contributor, arc.contributor, sir.contributor, fse.contributor, context.contributor];
  const uncertaintyFlags = [
    ...scfc.uncertaintyFlags,
    ...arc.uncertaintyFlags,
    ...sir.uncertaintyFlags,
    ...fse.uncertaintyFlags,
    ...context.uncertaintyFlags,
  ].sort();

  const requestsReview =
    scfc.requestsReview || arc.requestsReview || sir.requestsReview || fse.requestsReview;
  const strongAgreement = detectStrongAgreement(input);

  let neverGuessImpact = 0;
  if (uncertaintyFlags.length > 0) {
    neverGuessImpact = -Math.min(25, uncertaintyFlags.length * 3);
    contributors.push({
      engine: "context",
      score: clampConfidence(100 + neverGuessImpact),
      weight: 0,
      impact: neverGuessImpact,
      explanation: `Never Guess rule applied for ${uncertaintyFlags.length} uncertainty signal(s)`,
    });
  }

  if (strongAgreement) {
    contributors.push({
      engine: "context",
      score: 100,
      weight: 0,
      impact: 12,
      explanation: "Strong Agreement across SCFC, ARC, SIR, and FSE",
    });
  }

  return {
    contributors,
    uncertaintyFlags,
    requestsReview,
    strongAgreement,
    criticalFailure: fse.criticalFailure,
  };
}

export function weightedConfidence(contributors: TrustContributor[]): number {
  const weighted = contributors.filter((item) => item.weight > 0);
  if (weighted.length === 0) return 0;

  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  const base = weighted.reduce((sum, item) => sum + item.score * item.weight, 0) / weightSum;
  const impactSum = contributors.reduce((sum, item) => sum + item.impact, 0);
  return clampConfidence(base + impactSum);
}
