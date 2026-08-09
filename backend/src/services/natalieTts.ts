import { estimateMp3DurationSeconds } from "../lib/cost-calculator.js";
import { logUsageEvent } from "../lib/metering.js";

export const DEFAULT_TTS_PROVIDER = "azure";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
export const DEFAULT_AZURE_SPEECH_REGION = "eastus";
export const DEFAULT_AZURE_SPEECH_VOICE = "he-IL-HilaNeural";
export const AZURE_TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_TTS_VOICE = "nova";
const MAX_TTS_TEXT_LENGTH = 3500;

export type TtsProvider = "azure" | "elevenlabs" | "openai";

export type SynthesizeSpeechParams = {
  text: string;
  provider?: TtsProvider;
  organizationId?: string | null;
};

export type SynthesizeSpeechCredentials = {
  azureSpeechKey?: string;
  azureSpeechRegion?: string;
  azureSpeechVoice?: string;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  openAiVoice?: string;
};

export type SynthesizeSpeechDeps = {
  fetchFn: typeof fetch;
};

export type SynthesizeResultSuccess = {
  ok: true;
  audio: Buffer;
  contentType: string;
};

export type SynthesizeResultFailure = {
  ok: false;
  status: number;
  error: string;
};

export type SynthesizeResult = SynthesizeResultSuccess | SynthesizeResultFailure;

export async function synthesizeSpeech(
  params: SynthesizeSpeechParams,
  credentials: SynthesizeSpeechCredentials,
  deps: SynthesizeSpeechDeps
): Promise<SynthesizeResult> {
  const text = params.text.trim();
  if (!text) {
    return { ok: false, status: 400, error: "Voice text is required" };
  }

  const provider = params.provider ?? DEFAULT_TTS_PROVIDER;
  const input = text.slice(0, MAX_TTS_TEXT_LENGTH);

  if (provider === "azure") {
    return synthesizeWithAzure(input, credentials, deps.fetchFn);
  }

  if (provider === "elevenlabs") {
    return synthesizeWithElevenLabs(input, credentials, deps.fetchFn, params.organizationId);
  }

  return synthesizeWithOpenAi(input, credentials, deps.fetchFn, params.organizationId);
}

function buildAzureSpeechUrl(region: string): string {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function escapeSsmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildAzureSsml(text: string, voice: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="he-IL"><voice name="${voice}">${escapeSsmlText(text)}</voice></speak>`;
}

async function synthesizeWithAzure(
  text: string,
  credentials: SynthesizeSpeechCredentials,
  fetchFn: typeof fetch
): Promise<SynthesizeResult> {
  const azureSpeechKey = credentials.azureSpeechKey?.trim();
  if (!azureSpeechKey) {
    return {
      ok: false,
      status: 503,
      error: "Azure Speech is not configured (AZURE_SPEECH_KEY missing)",
    };
  }

  const region = credentials.azureSpeechRegion?.trim() || DEFAULT_AZURE_SPEECH_REGION;
  const voice = credentials.azureSpeechVoice?.trim() || DEFAULT_AZURE_SPEECH_VOICE;
  const url = buildAzureSpeechUrl(region);

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": azureSpeechKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": AZURE_TTS_OUTPUT_FORMAT,
    },
    body: buildAzureSsml(text, voice),
  });

  return toSynthesizeResult(response, "azure");
}

async function synthesizeWithElevenLabs(
  text: string,
  credentials: SynthesizeSpeechCredentials,
  fetchFn: typeof fetch,
  organizationId?: string | null
): Promise<SynthesizeResult> {
  const elevenLabsApiKey = credentials.elevenLabsApiKey?.trim();
  if (!elevenLabsApiKey) {
    return {
      ok: false,
      status: 503,
      error: "ElevenLabs voice is not configured (ELEVENLABS_API_KEY missing)",
    };
  }

  const voiceId = credentials.elevenLabsVoiceId?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
  const model = credentials.elevenLabsModel?.trim() || DEFAULT_ELEVENLABS_MODEL;
  const url = `${ELEVENLABS_BASE_URL}/${voiceId}?output_format=mp3_44100_128`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
    }),
  });

  const result = await toSynthesizeResult(response, "elevenlabs");
  if (result.ok) {
    meterTtsUsage(organizationId, "elevenlabs", text.length, result.audio.length);
  }
  return result;
}

async function synthesizeWithOpenAi(
  text: string,
  credentials: SynthesizeSpeechCredentials,
  fetchFn: typeof fetch,
  organizationId?: string | null
): Promise<SynthesizeResult> {
  const openAiApiKey = credentials.openAiApiKey?.trim();
  if (!openAiApiKey) {
    return {
      ok: false,
      status: 503,
      error: "OpenAI voice is not configured (OPENAI_API_KEY missing)",
    };
  }

  const model = credentials.openAiModel?.trim() || DEFAULT_OPENAI_TTS_MODEL;
  const voice = credentials.openAiVoice?.trim() || DEFAULT_OPENAI_TTS_VOICE;

  const response = await fetchFn(OPENAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: "mp3",
    }),
  });

  const result = await toSynthesizeResult(response, "openai");
  if (result.ok) {
    meterTtsUsage(organizationId, "openai", text.length, result.audio.length);
  }
  return result;
}

function meterTtsUsage(
  organizationId: string | null | undefined,
  provider: "elevenlabs" | "openai",
  textChars: number,
  audioByteLength: number
): void {
  const orgId = organizationId?.trim();
  if (!orgId) return;
  if (provider === "elevenlabs") {
    void logUsageEvent({
      orgId,
      provider: "ELEVENLABS",
      feature: "voice_tts",
      usageDetails: { kind: "elevenlabs", characters: textChars },
    });
    return;
  }
  void logUsageEvent({
    orgId,
    provider: "OPENAI_TTS",
    feature: "voice_tts",
    usageDetails: {
      kind: "openai_tts",
      textChars,
      audioDurationSeconds: estimateMp3DurationSeconds(audioByteLength),
    },
  });
}

async function toSynthesizeResult(
  response: Response,
  provider: TtsProvider
): Promise<SynthesizeResult> {
  if (!response.ok) {
    let errorText = response.statusText;
    try {
      errorText = await response.text();
    } catch {
      // Keep statusText when response body cannot be read.
    }
    console.error("[natalieTts] provider error", {
      provider,
      status: response.status,
      body: errorText,
    });
    return {
      ok: false,
      status: 502,
      error: `Voice generation failed: ${errorText}`,
    };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return { ok: true, audio, contentType: "audio/mpeg" };
}
