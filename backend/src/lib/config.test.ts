import test from "node:test";
import assert from "node:assert/strict";

import { config } from "./config.js";

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function resolveDefaultAiVoiceProvider(): string {
  return optional(
    "AI_VOICE_PROVIDER",
    optional("ELEVENLABS_API_KEY") ? "elevenlabs" : optional("OPENAI_API_KEY") ? "openai" : "browser"
  );
}

test("aiVoice provider defaults to elevenlabs when ELEVENLABS_API_KEY is set", () => {
  const saved = {
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    AI_VOICE_PROVIDER: process.env.AI_VOICE_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  try {
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    delete process.env.AI_VOICE_PROVIDER;
    delete process.env.OPENAI_API_KEY;

    assert.equal(resolveDefaultAiVoiceProvider(), "elevenlabs");
  } finally {
    if (saved.ELEVENLABS_API_KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved.ELEVENLABS_API_KEY;

    if (saved.AI_VOICE_PROVIDER === undefined) delete process.env.AI_VOICE_PROVIDER;
    else process.env.AI_VOICE_PROVIDER = saved.AI_VOICE_PROVIDER;

    if (saved.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.OPENAI_API_KEY;
  }
});

test("aiVoice elevenLabsVoiceId defaults to Rachel voice id when unset", () => {
  const expected = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
  assert.equal(config.aiVoice.elevenLabsVoiceId, expected);
});

test("aiVoice elevenLabsModel defaults to eleven_multilingual_v2 when unset", () => {
  const expected = process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2";
  assert.equal(config.aiVoice.elevenLabsModel, expected);
});
