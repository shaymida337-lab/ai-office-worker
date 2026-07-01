import type { ConfidenceEvidenceItem, ConfidenceEvaluationInput } from "./confidenceTypes.js";

const EVIDENCE_WEIGHTS = {
  claudeExtraction: 0.3,
  ocr: 0.1,
  supplierMatch: 0.15,
  duplicate: 0.1,
  amount: 0.15,
  trustEngine: 0.1,
  historical: 0.1,
} as const;

export function aggregateConfidenceEvidence(input: ConfidenceEvaluationInput): {
  finalScore: number;
  supportingEvidence: ConfidenceEvidenceItem[];
  missingEvidence: string[];
} {
  const supportingEvidence: ConfidenceEvidenceItem[] = [
    evidence(
      "claude_extraction",
      input.confidenceScore,
      EVIDENCE_WEIGHTS.claudeExtraction,
      "Claude extraction confidence",
    ),
    evidence("ocr", input.ocrConfidence, EVIDENCE_WEIGHTS.ocr, "OCR confidence"),
    evidence(
      "supplier_match",
      input.supplierMatchConfidence,
      EVIDENCE_WEIGHTS.supplierMatch,
      input.supplierName ? `Supplier: ${input.supplierName}` : "Supplier match confidence",
    ),
    evidence(
      "duplicate_check",
      input.isConfirmedDuplicate ? 0 : input.isDuplicateSuspicion ? 0.5 : 1,
      EVIDENCE_WEIGHTS.duplicate,
      input.isConfirmedDuplicate
        ? "Confirmed duplicate"
        : input.isDuplicateSuspicion
          ? "Duplicate suspicion"
          : "No duplicate signals",
    ),
    evidence(
      "amount_resolution",
      input.amountConfidence,
      EVIDENCE_WEIGHTS.amount,
      input.amount != null ? `Amount ${input.amount}` : "Amount unresolved",
    ),
    evidence(
      "trust_engine",
      normalizePercent(input.trustEngineConfidence),
      EVIDENCE_WEIGHTS.trustEngine,
      "Trust engine aggregate",
    ),
    evidence(
      "historical_consistency",
      input.historicalConsistency,
      EVIDENCE_WEIGHTS.historical,
      "Historical consistency with prior documents",
    ),
  ];

  const present = supportingEvidence.filter((item) => item.present && item.score != null);
  const totalWeight = present.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? present.reduce((sum, item) => sum + (item.score ?? 0) * item.weight, 0) / totalWeight
      : 0;

  const missingEvidence: string[] = [];
  if (input.confidenceScore == null) missingEvidence.push("claude_extraction_confidence");
  if (input.supplierName == null && !input.missingSupplier) missingEvidence.push("supplier_name");
  if (input.amount == null) missingEvidence.push("resolved_amount");
  if (!input.hasAttachment) missingEvidence.push("attachment");
  if (!input.paymentDirection || input.paymentDirection === "unknown") {
    missingEvidence.push("payment_direction");
  }

  return {
    finalScore: roundScore(weightedScore),
    supportingEvidence,
    missingEvidence,
  };
}

function evidence(
  source: string,
  score: number | null,
  weight: number,
  detail: string,
): ConfidenceEvidenceItem {
  return {
    source,
    score: score == null ? null : roundScore(score),
    weight,
    detail,
    present: score != null,
  };
}

function normalizePercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 1 ? roundScore(value / 100) : roundScore(value);
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

export { EVIDENCE_WEIGHTS };
