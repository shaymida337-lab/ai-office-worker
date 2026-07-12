import test from "node:test";
import assert from "node:assert/strict";
import { pickHebrewVoice } from "./speechSynthesisSupport.js";

test("prefers exact he-IL voice", () => {
  const voices = [
    { lang: "en-US", name: "Alex" },
    { lang: "he", name: "GenericHebrew" },
    { lang: "he-IL", name: "Carmit" },
  ];
  assert.equal(pickHebrewVoice(voices)?.name, "Carmit");
});

test("prefers local-service Hebrew voice over remote", () => {
  const voices = [
    { lang: "he-IL", name: "CloudHe", localService: false },
    { lang: "he-IL", name: "LocalHe", localService: true },
  ];
  assert.equal(pickHebrewVoice(voices)?.name, "LocalHe");
});

test("falls back to any he-* voice when no he-IL", () => {
  const voices = [
    { lang: "en-GB", name: "Daniel" },
    { lang: "he", name: "OnlyHe" },
  ];
  assert.equal(pickHebrewVoice(voices)?.name, "OnlyHe");
});

test("returns null when no Hebrew voice exists", () => {
  assert.equal(pickHebrewVoice([{ lang: "en-US", name: "Alex" }]), null);
  assert.equal(pickHebrewVoice([]), null);
});

test("handles underscore locale format (he_IL)", () => {
  const voices = [{ lang: "he_IL", name: "AndroidHe" }];
  assert.equal(pickHebrewVoice(voices)?.name, "AndroidHe");
});
