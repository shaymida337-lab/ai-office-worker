import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVoiceHeardClarificationPrompt,
  parseVoiceClarificationIntent,
  shouldGateVoiceTranscription,
} from "./voiceConfidenceGate";

test("shouldGateVoiceTranscription gates on low confidence", () => {
  assert.equal(shouldGateVoiceTranscription({ confidence: 0.61 }), true);
  assert.equal(shouldGateVoiceTranscription({ confidence: 0.62 }), false);
});

test("shouldGateVoiceTranscription gates on clarification/action flags", () => {
  assert.equal(shouldGateVoiceTranscription({ confidence: 0.91, clarificationRequired: true }), true);
  assert.equal(shouldGateVoiceTranscription({ confidence: 0.91, actionBlocked: true }), true);
  assert.equal(shouldGateVoiceTranscription({ confidence: 0.91 }), false);
});

test("parseVoiceClarificationIntent parses yes/no/correction", () => {
  assert.equal(parseVoiceClarificationIntent("כן"), "confirm");
  assert.equal(parseVoiceClarificationIntent("לא"), "reject");
  assert.equal(parseVoiceClarificationIntent("לא, בעצם בארבע"), "correction");
  assert.equal(parseVoiceClarificationIntent(""), "empty");
});

test("buildVoiceHeardClarificationPrompt uses required wording", () => {
  assert.equal(buildVoiceHeardClarificationPrompt("תבטלי פגישה"), 'שמעתי: "תבטלי פגישה" — זה נכון?');
});
