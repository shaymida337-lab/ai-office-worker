export type VoiceConfirmationIntent = "accept" | "reject" | "cancel" | "none";

const ACCEPT_PATTERNS = [
  /^כן$/,
  /^נכון$/,
  /^אשר$/,
  /^מאשר$/,
  /^מאשרת$/,
  /^בסדר$/,
  /^יאללה$/,
  /^ok$/i,
  /^yes$/i,
];

const REJECT_PATTERNS = [/^לא$/, /^אל$/, /^no$/i];

const CANCEL_PATTERNS = [/^בטל$/, /^ביטול$/, /^עזוב$/, /^cancel$/i, /^stop$/i];

export function parseVoiceConfirmationIntent(transcript: string): VoiceConfirmationIntent {
  const normalized = transcript.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return "none";
  if (CANCEL_PATTERNS.some((pattern) => pattern.test(normalized))) return "cancel";
  if (REJECT_PATTERNS.some((pattern) => pattern.test(normalized))) return "reject";
  if (ACCEPT_PATTERNS.some((pattern) => pattern.test(normalized))) return "accept";
  return "none";
}

export function isVoiceConfirmationUtterance(transcript: string): boolean {
  return parseVoiceConfirmationIntent(transcript) !== "none";
}
