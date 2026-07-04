import { assessTranscriptConfidence, buildLowConfidenceClarification } from "./sttConfidence.js";
import { normalizeHebrewNumbersInTranscript } from "./sttHebrewNumbers.js";
import { buildNameClarificationQuestion, correctBusinessNamesInTranscript } from "./sttNameCorrection.js";
import { buildActionSafetyClarification, detectRiskyActions } from "./sttActionSafety.js";
import { recordSttAccuracyMetric } from "./sttMetrics.js";
import type { SttAccuracyResult, SttVocabulary } from "./sttAccuracyTypes.js";
import { loadSttVocabulary } from "./sttVocabulary.js";
import { errorDetails } from "../../lib/errors.js";

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function applyBusinessTermHints(text: string, vocabulary: SttVocabulary) {
  let normalized = text;
  const corrections = [];

  try {
    for (const term of vocabulary.businessTerms) {
      if (term.length < 4) continue;
      const fuzzy = term.slice(0, Math.max(3, term.length - 1));
      if (normalized.includes(term) || !normalized.toLowerCase().includes(fuzzy.toLowerCase())) continue;
      const pattern = new RegExp(fuzzy, "iu");
      if (!pattern.test(normalized)) continue;
      const next = normalized.replace(pattern, term);
      if (next !== normalized) {
        corrections.push({
          kind: "business_term" as const,
          original: fuzzy,
          corrected: term,
          confidence: 0.8,
          ambiguous: false,
        });
        normalized = next;
      }
    }
  } catch {
    return { text, corrections: [] };
  }

  return { text: normalized, corrections };
}

function buildNormalizationFallbackResult(input: {
  organizationId: string;
  rawTranscript: string;
  sessionId?: string | null;
  skipClarification?: boolean;
}): SttAccuracyResult {
  const result: SttAccuracyResult = {
    rawTranscript: input.rawTranscript,
    normalizedTranscript: input.rawTranscript,
    confidence: 0.55,
    confidenceLevel: "medium",
    corrections: [],
    clarificationRequired: false,
    clarificationMessage: null,
    actionBlocked: false,
    detectedActions: [],
    ambiguousNameSuggestions: [],
  };
  recordSttAccuracyMetric({
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    result,
  });
  return result;
}

export async function processTranscriptAccuracy(input: {
  organizationId: string;
  rawTranscript: string;
  sessionId?: string | null;
  vocabulary?: SttVocabulary;
  skipClarification?: boolean;
  requestId?: string | null;
}): Promise<SttAccuracyResult> {
  const rawTranscript = input.rawTranscript.trim();
  const vocabulary = input.vocabulary ?? (await loadSttVocabulary(input.organizationId));
  const correctionContext = {
    organizationId: input.organizationId,
    requestId: input.requestId ?? null,
  };

  try {
    let normalizedTranscript = normalizeWhitespace(rawTranscript);
    const corrections = [];

    const numberResult = normalizeHebrewNumbersInTranscript(normalizedTranscript);
    normalizedTranscript = numberResult.text;
    corrections.push(...numberResult.corrections);

    const nameResult = correctBusinessNamesInTranscript(normalizedTranscript, vocabulary, correctionContext);
    normalizedTranscript = nameResult.text;
    corrections.push(...nameResult.corrections);

    const termResult = applyBusinessTermHints(normalizedTranscript, vocabulary);
    normalizedTranscript = termResult.text;
    corrections.push(...termResult.corrections);

    const detectedActions = detectRiskyActions(normalizedTranscript);
    const { score, level } = assessTranscriptConfidence({
      rawTranscript,
      normalizedTranscript,
      corrections,
      ambiguousNameCount: nameResult.ambiguousSuggestions.length,
      detectedActions,
    });

    const nameClarification = buildNameClarificationQuestion(nameResult.ambiguousSuggestions);
    const lowConfidenceClarification = buildLowConfidenceClarification({
      confidence: score,
      normalizedTranscript,
      corrections,
    });
    const actionClarification =
      detectedActions.length > 0 && score < 0.8 ? buildActionSafetyClarification(detectedActions) : null;

    const clarificationMessage =
      input.skipClarification ? null : actionClarification ?? nameClarification ?? lowConfidenceClarification;

    const actionBlocked = detectedActions.length > 0 && score < 0.8;

    const result: SttAccuracyResult = {
      rawTranscript,
      normalizedTranscript,
      confidence: score,
      confidenceLevel: level,
      corrections,
      clarificationRequired: Boolean(clarificationMessage),
      clarificationMessage,
      actionBlocked,
      detectedActions,
      ambiguousNameSuggestions: nameResult.ambiguousSuggestions,
    };

    recordSttAccuracyMetric({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      result,
    });

    return result;
  } catch (err) {
    console.warn("[stt/normalization] degraded to raw transcript", {
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      stage: "normalization",
      ...errorDetails(err),
    });
    return buildNormalizationFallbackResult(input);
  }
}
