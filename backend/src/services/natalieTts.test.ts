import test from "node:test";
import assert from "node:assert/strict";

import { synthesizeSpeech } from "./natalieTts.js";

const elevenLabsCredentials = {
  elevenLabsApiKey: "el-test-key",
  elevenLabsVoiceId: "voice-abc123",
  elevenLabsModel: "eleven_multilingual_v2",
};

const openAiCredentials = {
  openAiApiKey: "sk-test-key",
  openAiModel: "gpt-4o-mini-tts",
  openAiVoice: "nova",
};

function createMockFetch(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: ArrayBuffer;
  errorText?: string;
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const audioBytes = options.body ?? Uint8Array.from([0xff, 0xfb, 0x90, 0x00]).buffer;

  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: options.ok ?? true,
      status: options.status ?? (options.ok === false ? 500 : 200),
      statusText: options.statusText ?? "OK",
      arrayBuffer: async () => audioBytes,
      text: async () => options.errorText ?? options.statusText ?? "error",
    } as Response;
  }) as typeof fetch;

  return { fetchFn, calls };
}

test("synthesizeSpeech returns ok:false with status 400 when text is empty or whitespace only", async () => {
  const { fetchFn } = createMockFetch({});

  for (const text of ["", "   ", "\n\t"]) {
    const result = await synthesizeSpeech({ text, provider: "elevenlabs" }, elevenLabsCredentials, { fetchFn });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.match(result.error, /text/i);
    }
  }
});

test("synthesizeSpeech returns ok:false 503 when elevenlabs provider lacks elevenLabsApiKey", async () => {
  const { fetchFn } = createMockFetch({});

  const result = await synthesizeSpeech(
    { text: "שלום נטלי", provider: "elevenlabs" },
    { elevenLabsVoiceId: "voice-1", elevenLabsModel: "eleven_multilingual_v2" },
    { fetchFn }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.match(result.error, /ELEVENLABS_API_KEY/);
  }
});

test("synthesizeSpeech calls ElevenLabs with correct URL, headers, and body on success", async () => {
  const { fetchFn, calls } = createMockFetch({});

  const result = await synthesizeSpeech(
    { text: "שלום נטלי", provider: "elevenlabs" },
    elevenLabsCredentials,
    { fetchFn }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(Buffer.isBuffer(result.audio));
    assert.equal(result.contentType, "audio/mpeg");
  }

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsCredentials.elevenLabsVoiceId}`
  );

  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["xi-api-key"], elevenLabsCredentials.elevenLabsApiKey);

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.text, "שלום נטלי");
  assert.equal(body.model_id, elevenLabsCredentials.elevenLabsModel);
});

test("synthesizeSpeech returns ok:false 503 when openai provider lacks openAiApiKey", async () => {
  const { fetchFn } = createMockFetch({});

  const result = await synthesizeSpeech(
    { text: "שלום נטלי", provider: "openai" },
    { openAiModel: "gpt-4o-mini-tts", openAiVoice: "nova" },
    { fetchFn }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.match(result.error, /OPENAI_API_KEY/);
  }
});

test("synthesizeSpeech calls OpenAI speech API with correct URL, headers, and body on success", async () => {
  const { fetchFn, calls } = createMockFetch({});

  const result = await synthesizeSpeech(
    { text: "שלום נטלי", provider: "openai" },
    openAiCredentials,
    { fetchFn }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(Buffer.isBuffer(result.audio));
    assert.equal(result.contentType, "audio/mpeg");
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.openai.com/v1/audio/speech");

  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${openAiCredentials.openAiApiKey}`);

  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.model, openAiCredentials.openAiModel);
  assert.equal(body.voice, openAiCredentials.openAiVoice);
  assert.equal(body.input, "שלום נטלי");
});

test("synthesizeSpeech returns ok:false 502 when fetchFn response is not ok", async () => {
  const { fetchFn } = createMockFetch({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    errorText: "rate limit exceeded",
  });

  const result = await synthesizeSpeech(
    { text: "שלום נטלי", provider: "elevenlabs" },
    elevenLabsCredentials,
    { fetchFn }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
    assert.match(result.error, /rate limit exceeded|Too Many Requests|failed/i);
  }
});

test("synthesizeSpeech defaults to elevenlabs when provider is omitted", async () => {
  const { fetchFn, calls } = createMockFetch({});

  const result = await synthesizeSpeech(
    { text: "שלום נטלי" } as { text: string; provider: "elevenlabs" | "openai" },
    elevenLabsCredentials,
    { fetchFn }
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /api\.elevenlabs\.io\/v1\/text-to-speech\//);
});
