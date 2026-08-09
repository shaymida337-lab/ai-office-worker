import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAnthropicHaikuCostUsd,
  calculateElevenLabsCostUsd,
  calculateOpenAiTtsCostUsd,
  calculateTwilioWhatsAppCostUsd,
  calculateWhisperCostUsd,
  monthlyWarnThresholdUsd,
} from "../lib/cost-calculator.js";

test("Anthropic Haiku pricing matches $1/$5 per 1M tokens", () => {
  const calc = calculateAnthropicHaikuCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(calc.estimatedCostUsd, 6);
  assert.equal(calc.units, 2_000_000);
});

test("Whisper rounds duration up to whole seconds", () => {
  const calc = calculateWhisperCostUsd({ durationSeconds: 0.1 });
  assert.equal(calc.units, 1);
  assert.equal(calc.estimatedCostUsd, 0.0001);
});

test("OpenAI TTS uses text + audio token estimates", () => {
  const calc = calculateOpenAiTtsCostUsd({ textChars: 4, audioDurationSeconds: 1 });
  assert.equal(calc.textTokens, 1);
  assert.equal(calc.audioTokens, 25);
  assert.ok(calc.estimatedCostUsd > 0);
});

test("ElevenLabs is $0.10 per 1k characters", () => {
  const calc = calculateElevenLabsCostUsd({ characters: 1000 });
  assert.equal(calc.estimatedCostUsd, 0.1);
});

test("Twilio WhatsApp is $0.005 per message", () => {
  const calc = calculateTwilioWhatsAppCostUsd({ messageCount: 2 });
  assert.equal(calc.estimatedCostUsd, 0.01);
});

test("monthly warn thresholds map starter→$6 and growth→$10", () => {
  assert.equal(monthlyWarnThresholdUsd("starter"), 6);
  assert.equal(monthlyWarnThresholdUsd("growth"), 10);
  assert.equal(monthlyWarnThresholdUsd(null), 6);
});
