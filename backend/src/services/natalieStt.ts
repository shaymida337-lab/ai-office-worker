export const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
export const WHISPER_MODEL = "whisper-1";
export const WHISPER_LANGUAGE = "he";
export const WHISPER_REQUEST_TIMEOUT_MS = 60_000;

export type TranscribeAudioCredentials = {
  openAiApiKey?: string;
};

export type TranscribeAudioDeps = {
  fetchFn: typeof fetch;
};

export type TranscribeResultSuccess = {
  ok: true;
  text: string;
};

export type TranscribeResultFailure = {
  ok: false;
  status: number;
  error: string;
};

export type TranscribeResult = TranscribeResultSuccess | TranscribeResultFailure;

function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
  };
  return map[base] ?? "audio";
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  credentials: TranscribeAudioCredentials,
  deps: TranscribeAudioDeps,
  promptHint?: string
): Promise<TranscribeResult> {
  if (!audioBuffer.length) {
    return { ok: false, status: 400, error: "Audio file is required" };
  }

  const openAiApiKey = credentials.openAiApiKey?.trim();
  if (!openAiApiKey) {
    return {
      ok: false,
      status: 503,
      error: "OpenAI transcription is not configured (OPENAI_API_KEY missing)",
    };
  }

  const normalizedMimeType = mimeType.split(";")[0]?.trim() || "application/octet-stream";
  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: normalizedMimeType });
  form.append("file", blob, `recording.${extensionForMimeType(normalizedMimeType)}`);
  form.append("model", WHISPER_MODEL);
  form.append("language", WHISPER_LANGUAGE);
  form.append("response_format", "json");
  const trimmedPromptHint = promptHint?.trim();
  if (trimmedPromptHint) {
    form.append("prompt", trimmedPromptHint);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WHISPER_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetchFn(OPENAI_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error("[natalieStt] provider request failed", {
      aborted,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted ? "Transcription timed out" : "Transcription request failed",
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let errorText = response.statusText;
    try {
      errorText = await response.text();
    } catch {
      // Keep statusText when response body cannot be read.
    }
    console.error("[natalieStt] provider error", {
      status: response.status,
      body: errorText,
    });
    return {
      ok: false,
      status: 502,
      error: `Transcription failed: ${errorText}`,
    };
  }

  let payload: { text?: string };
  try {
    payload = (await response.json()) as { text?: string };
  } catch {
    return { ok: false, status: 502, error: "Transcription failed: invalid JSON response" };
  }

  const text = payload.text?.trim();
  if (!text) {
    return { ok: false, status: 502, error: "Transcription failed: empty text response" };
  }

  return { ok: true, text };
}
