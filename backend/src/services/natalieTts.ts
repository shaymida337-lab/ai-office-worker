export const DEFAULT_TTS_PROVIDER = "elevenlabs";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_OPENAI_TTS_VOICE = "nova";
const MAX_TTS_TEXT_LENGTH = 3500;

export type TtsProvider = "elevenlabs" | "openai";

export type SynthesizeSpeechParams = {
  text: string;
  provider?: TtsProvider;
};

export type SynthesizeSpeechCredentials = {
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

  if (provider === "elevenlabs") {
    return synthesizeWithElevenLabs(input, credentials, deps.fetchFn);
  }

  return synthesizeWithOpenAi(input, credentials, deps.fetchFn);
}

async function synthesizeWithElevenLabs(
  text: string,
  credentials: SynthesizeSpeechCredentials,
  fetchFn: typeof fetch
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

  return toSynthesizeResult(response, "elevenlabs");
}

async function synthesizeWithOpenAi(
  text: string,
  credentials: SynthesizeSpeechCredentials,
  fetchFn: typeof fetch
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

  return toSynthesizeResult(response, "openai");
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
