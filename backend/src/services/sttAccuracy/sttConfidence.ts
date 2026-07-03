import type { SttConfidenceLevel, SttCorrection } from "./sttAccuracyTypes.js";

export function assessTranscriptConfidence(input: {
  rawTranscript: string;
  normalizedTranscript: string;
  corrections: SttCorrection[];
  ambiguousNameCount: number;
  detectedActions: string[];
}): { score: number; level: SttConfidenceLevel } {
  let score = 0.92;

  const rawWords = input.rawTranscript.trim().split(/\s+/).filter(Boolean);
  if (rawWords.length <= 1) score -= 0.18;
  if (rawWords.length === 1 && rawWords[0]!.length <= 3) score -= 0.2;
  if (rawWords.length === 2) score -= 0.08;

  const ambiguousCorrections = input.corrections.filter((correction) => correction.ambiguous);
  score -= ambiguousCorrections.length * 0.2;
  score -= input.ambiguousNameCount * 0.15;

  const lowConfidenceCorrections = input.corrections.filter((correction) => correction.confidence < 0.85);
  score -= lowConfidenceCorrections.length * 0.08;

  if (input.rawTranscript !== input.normalizedTranscript && input.corrections.length === 0) {
    score -= 0.05;
  }

  if (input.detectedActions.length > 0) {
    score -= 0.12 * input.detectedActions.length;
  }

  if (/[^\u0590-\u05FFa-zA-Z0-9\s,.!?₪%-]/.test(input.rawTranscript)) {
    score -= 0.1;
  }

  const bounded = Math.max(0, Math.min(1, score));
  const level: SttConfidenceLevel = bounded >= 0.8 ? "high" : bounded >= 0.62 ? "medium" : "low";
  return { score: bounded, level };
}

export function buildLowConfidenceClarification(input: {
  confidence: number;
  normalizedTranscript: string;
  corrections: SttCorrection[];
}): string | null {
  if (input.confidence >= 0.62) return null;

  const amountCorrection = input.corrections.find((correction) => correction.kind === "hebrew_number");
  if (amountCorrection) {
    return `לא בטוחה ששמעתי נכון. אמרת ${amountCorrection.corrected}?`;
  }

  if (input.normalizedTranscript.trim()) {
    return `לא בטוחה ששמעתי נכון. אמרת "${input.normalizedTranscript}"?`;
  }

  return "לא בטוחה ששמעתי נכון. אפשר לחזור על זה?";
}
