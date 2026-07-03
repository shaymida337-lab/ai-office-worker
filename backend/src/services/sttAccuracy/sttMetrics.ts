import type { SttAccuracyResult } from "./sttAccuracyTypes.js";

export type SttAccuracyMetricSnapshot = {
  at: number;
  organizationId: string;
  sessionId: string | null;
  rawTranscript: string;
  normalizedTranscript: string;
  confidence: number;
  correctionsApplied: number;
  clarificationRequired: boolean;
  actionBlocked: boolean;
  success: boolean;
};

const snapshots: SttAccuracyMetricSnapshot[] = [];
const MAX_SNAPSHOTS = 200;

export function resetSttAccuracyMetrics() {
  snapshots.length = 0;
}

export function getSttAccuracyMetricSnapshots(): SttAccuracyMetricSnapshot[] {
  return [...snapshots];
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b0\d{1,2}[-\s]?\d{3}[-\s]?\d{4}\b/g, "[phone]")
    .replace(/\b\d{7,}\b/g, "[number]")
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*₪?/g, "[amount]");
}

export function recordSttAccuracyMetric(input: {
  organizationId: string;
  sessionId?: string | null;
  result: SttAccuracyResult;
  redact?: boolean;
}) {
  const redact = input.redact ?? process.env.NODE_ENV === "production";
  const rawTranscript = redact ? redactSensitiveText(input.result.rawTranscript) : input.result.rawTranscript;
  const normalizedTranscript = redact
    ? redactSensitiveText(input.result.normalizedTranscript)
    : input.result.normalizedTranscript;

  snapshots.push({
    at: Date.now(),
    organizationId: input.organizationId,
    sessionId: input.sessionId ?? null,
    rawTranscript,
    normalizedTranscript,
    confidence: input.result.confidence,
    correctionsApplied: input.result.corrections.length,
    clarificationRequired: input.result.clarificationRequired,
    actionBlocked: input.result.actionBlocked,
    success: !input.result.clarificationRequired,
  });
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
}
