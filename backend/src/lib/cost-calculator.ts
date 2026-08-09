/**
 * Exact unit prices for passive org COGS metering.
 * Do not use for customer invoices — shadow metering only.
 */

export const ANTHROPIC_HAIKU_INPUT_USD_PER_1M = 1.0;
export const ANTHROPIC_HAIKU_OUTPUT_USD_PER_1M = 5.0;
export const OPENAI_WHISPER_USD_PER_MINUTE = 0.006;
export const OPENAI_TTS_TEXT_USD_PER_1M_TOKENS = 0.6;
export const OPENAI_TTS_AUDIO_USD_PER_1M_TOKENS = 12.0;
export const ELEVENLABS_USD_PER_1K_CHARS = 0.1;
export const TWILIO_WHATSAPP_USD_PER_MESSAGE = 0.005;

/** Starter ≈ Basic, Growth ≈ Full (warn-only thresholds). */
export const MONTHLY_COST_WARN_USD_BY_PLAN = {
  starter: 6,
  growth: 10,
  default: 6,
} as const;

export type AnthropicUsageUnits = {
  inputTokens: number;
  outputTokens: number;
};

export type WhisperUsageUnits = {
  /** Audio duration in seconds (rounded up to whole seconds for billing). */
  durationSeconds: number;
};

export type OpenAiTtsUsageUnits = {
  textChars: number;
  /** Estimated audio duration in seconds (from audio bytes when API omits usage). */
  audioDurationSeconds: number;
};

export type ElevenLabsUsageUnits = {
  characters: number;
};

export type TwilioUsageUnits = {
  messageCount: number;
};

export function calculateAnthropicHaikuCostUsd(usage: AnthropicUsageUnits): {
  units: number;
  estimatedCostUsd: number;
} {
  const inputTokens = Math.max(0, Number(usage.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage.outputTokens) || 0);
  const cost =
    (inputTokens / 1_000_000) * ANTHROPIC_HAIKU_INPUT_USD_PER_1M +
    (outputTokens / 1_000_000) * ANTHROPIC_HAIKU_OUTPUT_USD_PER_1M;
  return { units: inputTokens + outputTokens, estimatedCostUsd: roundUsd(cost) };
}

export function calculateWhisperCostUsd(usage: WhisperUsageUnits): {
  units: number;
  estimatedCostUsd: number;
} {
  const seconds = Math.max(0, Number(usage.durationSeconds) || 0);
  const billedSeconds = Math.ceil(seconds);
  const minutes = billedSeconds / 60;
  return {
    units: billedSeconds,
    estimatedCostUsd: roundUsd(minutes * OPENAI_WHISPER_USD_PER_MINUTE),
  };
}

/** gpt-4o-mini-tts: text tokens ≈ chars/4; audio tokens ≈ 25/sec (OpenAI-style estimate). */
export function calculateOpenAiTtsCostUsd(usage: OpenAiTtsUsageUnits): {
  units: number;
  estimatedCostUsd: number;
  textTokens: number;
  audioTokens: number;
} {
  const textChars = Math.max(0, Number(usage.textChars) || 0);
  const audioDurationSeconds = Math.max(0, Number(usage.audioDurationSeconds) || 0);
  const textTokens = Math.max(1, Math.ceil(textChars / 4));
  const audioTokens = Math.max(1, Math.ceil(audioDurationSeconds * 25));
  const cost =
    (textTokens / 1_000_000) * OPENAI_TTS_TEXT_USD_PER_1M_TOKENS +
    (audioTokens / 1_000_000) * OPENAI_TTS_AUDIO_USD_PER_1M_TOKENS;
  return {
    units: textTokens + audioTokens,
    estimatedCostUsd: roundUsd(cost),
    textTokens,
    audioTokens,
  };
}

export function calculateElevenLabsCostUsd(usage: ElevenLabsUsageUnits): {
  units: number;
  estimatedCostUsd: number;
} {
  const characters = Math.max(0, Number(usage.characters) || 0);
  return {
    units: characters,
    estimatedCostUsd: roundUsd((characters / 1000) * ELEVENLABS_USD_PER_1K_CHARS),
  };
}

export function calculateTwilioWhatsAppCostUsd(usage: TwilioUsageUnits): {
  units: number;
  estimatedCostUsd: number;
} {
  const messageCount = Math.max(0, Number(usage.messageCount) || 0);
  return {
    units: messageCount,
    estimatedCostUsd: roundUsd(messageCount * TWILIO_WHATSAPP_USD_PER_MESSAGE),
  };
}

export function estimateMp3DurationSeconds(byteLength: number): number {
  // Conservative ~128 kbps MP3 → bytes * 8 / 128000
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0.1;
  return Math.max(0.1, (byteLength * 8) / 128_000);
}

export function monthlyWarnThresholdUsd(planId?: string | null): number {
  if (planId === "growth") return MONTHLY_COST_WARN_USD_BY_PLAN.growth;
  if (planId === "starter") return MONTHLY_COST_WARN_USD_BY_PLAN.starter;
  return MONTHLY_COST_WARN_USD_BY_PLAN.default;
}

function roundUsd(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}
