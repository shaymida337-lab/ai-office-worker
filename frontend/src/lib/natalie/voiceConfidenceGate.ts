export const DEFAULT_VOICE_CONFIDENCE_GATE_THRESHOLD = 0.62;

export type VoiceTranscriptionGateInput = {
  confidence?: number | null;
  clarificationRequired?: boolean;
  actionBlocked?: boolean;
  threshold?: number;
};

export function shouldGateVoiceTranscription(input: VoiceTranscriptionGateInput): boolean {
  const threshold = input.threshold ?? DEFAULT_VOICE_CONFIDENCE_GATE_THRESHOLD;
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence) ? input.confidence : null;
  if (input.actionBlocked) return true;
  if (input.clarificationRequired) return true;
  if (confidence !== null && confidence < threshold) return true;
  return false;
}

const CONFIRM_TOKENS = new Set(["כן", "כן.", "כן!", "מאשר", "מאשרת", "נכון", "זה נכון"]);
const REJECT_TOKENS = new Set(["לא", "לא.", "לא!", "ממש לא", "לא נכון", "בטל", "תבטלי", "תבטל"]);

export type VoiceClarificationIntent = "confirm" | "reject" | "correction" | "empty";

export function parseVoiceClarificationIntent(text: string): VoiceClarificationIntent {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return "empty";
  if (CONFIRM_TOKENS.has(normalized)) return "confirm";
  if (REJECT_TOKENS.has(normalized)) return "reject";
  return "correction";
}

export function buildVoiceHeardClarificationPrompt(text: string): string {
  return `שמעתי: "${text}" — זה נכון?`;
}
