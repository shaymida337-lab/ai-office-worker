import test from "node:test";
import assert from "node:assert/strict";

import { OPENAI_TRANSCRIPTION_URL, transcribeAudio } from "./natalieStt.js";

const credentials = {
  openAiApiKey: "sk-test-key",
};

function createMockFetch(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: Record<string, unknown>;
  errorText?: string;
}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: options.ok ?? true,
      status: options.status ?? (options.ok === false ? 500 : 200),
      statusText: options.statusText ?? "OK",
      json: async () => options.json ?? { text: "שלום נטלי" },
      text: async () => options.errorText ?? options.statusText ?? "error",
    } as Response;
  }) as typeof fetch;

  return { fetchFn, calls };
}

function formDataField(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (value === null) return null;
  if (typeof value === "string") return value;
  return null;
}

test("transcribeAudio returns ok:false 400 when audio buffer is empty", async () => {
  const { fetchFn } = createMockFetch({});

  const result = await transcribeAudio(Buffer.alloc(0), "audio/webm", credentials, { fetchFn });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.match(result.error, /audio/i);
  }
});

test("transcribeAudio returns ok:false 503 when openAiApiKey is missing", async () => {
  const { fetchFn } = createMockFetch({});

  const result = await transcribeAudio(
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    "audio/webm",
    {},
    { fetchFn }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.match(result.error, /OPENAI_API_KEY/);
  }
});

test("transcribeAudio calls OpenAI Whisper with correct URL, model, and language", async () => {
  const audioBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const { fetchFn, calls } = createMockFetch({ json: { text: "מה דחוף היום?" } });

  const result = await transcribeAudio(audioBuffer, "audio/webm", credentials, { fetchFn });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.text, "מה דחוף היום?");
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, OPENAI_TRANSCRIPTION_URL);

  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${credentials.openAiApiKey}`);

  const body = calls[0]?.init?.body;
  assert.ok(body instanceof FormData);
  assert.equal(formDataField(body, "model"), "whisper-1");
  assert.equal(formDataField(body, "language"), "he");
  assert.equal(formDataField(body, "response_format"), "json");

  const file = body.get("file");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "audio/webm");
});

test("transcribeAudio returns ok:false 502 when OpenAI response is not ok", async () => {
  const { fetchFn } = createMockFetch({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    errorText: "rate limit exceeded",
  });

  const result = await transcribeAudio(
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    "audio/webm",
    credentials,
    { fetchFn }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
    assert.match(result.error, /rate limit exceeded|failed/i);
  }
});
