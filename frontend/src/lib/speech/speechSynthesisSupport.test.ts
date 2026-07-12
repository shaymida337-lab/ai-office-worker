import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVoiceGender,
  hasHebrewFemaleVoice,
  pickHebrewVoice,
} from "./speechSynthesisSupport.js";

test("prefers female Hebrew voice over male (Sprint 3.3)", () => {
  const voices = [
    { lang: "he-IL", name: "Microsoft Asaf - Hebrew (Israel)", localService: true },
    { lang: "he-IL", name: "Carmit", localService: true },
  ];
  assert.equal(pickHebrewVoice(voices)?.name, "Carmit");
});

test("female preference beats exact-locale of a male voice", () => {
  const voices = [
    { lang: "he-IL", name: "Microsoft Asaf - Hebrew (Israel)", localService: true },
    { lang: "he", name: "Hila", localService: false },
  ];
  assert.equal(pickHebrewVoice(voices)?.name, "Hila");
});

test("falls back to unknown-gender Hebrew voice when no female", () => {
  const voices = [
    { lang: "he-IL", name: "Microsoft Asaf - Hebrew (Israel)", localService: true },
    { lang: "he-IL", name: "Google עברית", localService: false },
  ];
  assert.equal(pickHebrewVoice(voices)?.name, "Google עברית");
});

test("classifyVoiceGender identifies known names and tokens", () => {
  assert.equal(classifyVoiceGender("Carmit"), "female");
  assert.equal(classifyVoiceGender("Microsoft HilaOnline (Natural)"), "female");
  assert.equal(classifyVoiceGender("Microsoft Asaf - Hebrew"), "male");
  assert.equal(classifyVoiceGender("he-IL-AvriNeural"), "male");
  assert.equal(classifyVoiceGender("Hebrew Female Voice"), "female");
  assert.equal(classifyVoiceGender("Google עברית"), "unknown");
});

test("hasHebrewFemaleVoice detects presence", () => {
  assert.equal(hasHebrewFemaleVoice([{ lang: "he-IL", name: "Carmit" }]), true);
  assert.equal(hasHebrewFemaleVoice([{ lang: "he-IL", name: "Asaf" }]), false);
  assert.equal(hasHebrewFemaleVoice([{ lang: "en-US", name: "Samantha Female" }]), false);
});

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
