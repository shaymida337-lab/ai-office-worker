import test from "node:test";
import assert from "node:assert/strict";
import {
  appendTranscript,
  extractTranscripts,
  getSpeechRecognitionCtor,
  mapSpeechErrorToKind,
} from "./speechSupport.js";

test("detects SpeechRecognition constructor including webkit prefix", () => {
  class Fake {}
  assert.equal(getSpeechRecognitionCtor({ SpeechRecognition: Fake }), Fake);
  assert.equal(getSpeechRecognitionCtor({ webkitSpeechRecognition: Fake }), Fake);
  assert.equal(getSpeechRecognitionCtor({}), null);
  assert.equal(getSpeechRecognitionCtor(undefined), null);
  assert.equal(getSpeechRecognitionCtor({ SpeechRecognition: "not-a-fn" }), null);
});

test("maps browser error codes to human kinds", () => {
  assert.equal(mapSpeechErrorToKind("not-allowed"), "denied");
  assert.equal(mapSpeechErrorToKind("service-not-allowed"), "denied");
  assert.equal(mapSpeechErrorToKind("no-speech"), "no-speech");
  assert.equal(mapSpeechErrorToKind("audio-capture"), "no-speech");
  assert.equal(mapSpeechErrorToKind("network"), "generic");
  assert.equal(mapSpeechErrorToKind(undefined), "generic");
});

test("extracts final and interim transcripts from result event", () => {
  const event = {
    resultIndex: 0,
    results: [
      { isFinal: true, 0: { transcript: "כמה חשבוניות " } },
      { isFinal: false, 0: { transcript: "נכנסו החודש" } },
    ],
  };
  const { finalText, interimText } = extractTranscripts(event);
  assert.equal(finalText, "כמה חשבוניות");
  assert.equal(interimText, "נכנסו החודש");
});

test("extract respects resultIndex offset", () => {
  const event = {
    resultIndex: 1,
    results: [
      { isFinal: true, 0: { transcript: "ישן" } },
      { isFinal: true, 0: { transcript: "חדש" } },
    ],
  };
  assert.equal(extractTranscripts(event).finalText, "חדש");
});

test("appendTranscript merges without clobbering typed text", () => {
  assert.equal(appendTranscript("", "מה דחוף היום"), "מה דחוף היום");
  assert.equal(appendTranscript("תבדקי ", "מה דחוף היום"), "תבדקי מה דחוף היום");
  assert.equal(appendTranscript("קיים", "   "), "קיים");
});
