import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpokenText,
  buildVoiceDiagnostics,
  createNatalieVoiceSpeaker,
  loadVoicesWithRetry,
  resolveUtteranceLang,
  selectNatalieVoice,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from "./natalieVoice.js";

function voice(name: string, lang: string, localService = false): VoiceLike {
  return { name, lang, localService };
}

function createUtterance(text: string): UtteranceLike {
  return {
    text,
    lang: "",
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
  };
}

type FakeSynthOptions = {
  voices?: VoiceLike[];
  paused?: boolean;
  /** התנהגות speak: "start" מפעיל onstart מייד, "error" מפעיל onerror, "silent" לא עושה כלום. */
  speakBehavior?: "start" | "error" | "silent";
  errorCode?: string;
};

function createFakeSynth(options: FakeSynthOptions = {}) {
  const spoken: UtteranceLike[] = [];
  const calls: string[] = [];
  const listeners = new Map<string, Set<() => void>>();

  const synth: SynthLike & {
    spoken: UtteranceLike[];
    calls: string[];
    setVoices: (v: VoiceLike[]) => void;
    fireVoicesChanged: () => void;
  } = {
    paused: options.paused ?? false,
    speaking: false,
    pending: false,
    getVoices: () => currentVoices,
    speak(u: UtteranceLike) {
      calls.push("speak");
      spoken.push(u);
      synth.speaking = true;
      const behavior = options.speakBehavior ?? "start";
      if (behavior === "start") {
        queueMicrotask(() => u.onstart?.());
      } else if (behavior === "error") {
        queueMicrotask(() => u.onerror?.({ error: options.errorCode ?? "synthesis-failed" }));
      }
      // "silent" — לא קורה כלום (חסימה שקטה במובייל)
    },
    cancel() {
      calls.push("cancel");
      synth.speaking = false;
      synth.pending = false;
    },
    resume() {
      calls.push("resume");
      synth.paused = false;
    },
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    spoken,
    calls,
    setVoices(v: VoiceLike[]) {
      currentVoices = v;
    },
    fireVoicesChanged() {
      for (const l of listeners.get("voiceschanged") ?? []) l();
    },
  };

  let currentVoices = options.voices ?? [];
  return synth;
}

function createSpeaker(synth: SynthLike | null, overrides: Partial<Parameters<typeof createNatalieVoiceSpeaker>[0]> = {}) {
  return createNatalieVoiceSpeaker({
    synth,
    createUtterance,
    cancelDelayMs: 1,
    startTimeoutMs: 100,
    loadVoicesOptions: { timeoutMs: 200, intervalMs: 10 },
    isDev: false,
    ...overrides,
  });
}

// ── בחירת קול ──────────────────────────────────────────────

test("selects known female Hebrew voice over male Hebrew voice", () => {
  const voices = [
    voice("Microsoft Asaf - Hebrew (Israel)", "he-IL", true),
    voice("Microsoft Hila Online (Natural) - Hebrew (Israel)", "he-IL"),
  ];
  const pick = selectNatalieVoice(voices);
  assert.ok(pick);
  assert.equal(pick.voice.name, "Microsoft Hila Online (Natural) - Hebrew (Israel)");
  assert.equal(pick.tier, "known-female-hebrew");
});

test("selects Carmit (iOS) as known female Hebrew voice", () => {
  const voices = [voice("Carmit", "he-IL", true), voice("Samantha", "en-US", true)];
  const pick = selectNatalieVoice(voices);
  assert.ok(pick);
  assert.equal(pick.voice.name, "Carmit");
  assert.equal(pick.tier, "known-female-hebrew");
});

test("falls back to local Hebrew voice when no female Hebrew voice exists", () => {
  const voices = [
    voice("Microsoft Zira - English (United States)", "en-US", true),
    voice("Microsoft Asaf - Hebrew (Israel)", "he-IL", true),
  ];
  const pick = selectNatalieVoice(voices);
  assert.ok(pick);
  assert.equal(pick.voice.name, "Microsoft Asaf - Hebrew (Israel)");
  assert.equal(pick.tier, "local-hebrew");
  assert.equal(resolveUtteranceLang(pick), "he-IL");
});

test("recognizes legacy iw lang code as Hebrew (Android)", () => {
  const voices = [voice("Hebrew Israel", "iw-IL")];
  const pick = selectNatalieVoice(voices);
  assert.ok(pick);
  assert.equal(pick.tier, "any-hebrew");
  assert.equal(resolveUtteranceLang(pick), "he-IL");
});

test("falls back to known female English voice when no Hebrew voices exist, keeping matching lang", () => {
  const voices = [
    voice("Microsoft David - English (United States)", "en-US", true),
    voice("Microsoft Zira - English (United States)", "en-US", true),
  ];
  const pick = selectNatalieVoice(voices);
  assert.ok(pick);
  assert.equal(pick.voice.name, "Microsoft Zira - English (United States)");
  assert.equal(pick.tier, "female-english-fallback");
  assert.equal(resolveUtteranceLang(pick), "en-US");
});

test("diagnostics on this Windows machine: only Asaf Hebrew — reported honestly as not-female", () => {
  // בדיוק הקולות שקיימים בפועל במחשב הזה (Chrome + Edge, Windows)
  const voices = [
    voice("Microsoft Asaf - Hebrew (Israel)", "he-IL", true),
    voice("Microsoft Mark - English (United States)", "en-US", true),
    voice("Microsoft Zira - English (United States)", "en-US", true),
    voice("Microsoft David - English (United States)", "en-US", true),
  ];
  const diag = buildVoiceDiagnostics(voices);
  assert.deepEqual(diag.hebrewVoiceNames, ["Microsoft Asaf - Hebrew (Israel)"]);
  assert.equal(diag.selectedName, "Microsoft Asaf - Hebrew (Israel)");
  assert.equal(diag.selectedTier, "local-hebrew");
  // אסור לדווח שקיים קול עברי נשי כשיש רק את אסף
  assert.equal(diag.femaleHebrewAvailable, false);
  assert.ok(diag.selectionReason.includes("אינו מובטח"));
  // זירה האנגלית מזוהה נשית לפי שם, אבל היא לא עברית
  assert.deepEqual(diag.femaleIdentifiedByName, ["Microsoft Zira - English (United States)"]);
});

test("diagnostics with Edge online Hila: female Hebrew reported and selected", () => {
  const voices = [
    voice("Microsoft Asaf - Hebrew (Israel)", "he-IL", true),
    voice("Microsoft Hila Online (Natural) - Hebrew (Israel)", "he-IL"),
  ];
  const diag = buildVoiceDiagnostics(voices);
  assert.equal(diag.femaleHebrewAvailable, true);
  assert.equal(diag.selectedName, "Microsoft Hila Online (Natural) - Hebrew (Israel)");
  assert.equal(diag.selectedTier, "known-female-hebrew");
});

test("returns null for empty voice list without throwing", () => {
  assert.equal(selectNatalieVoice([]), null);
  assert.equal(resolveUtteranceLang(null), "he-IL");
});

// ── טעינת קולות ────────────────────────────────────────────

test("waits for voiceschanged when voices are not loaded yet, then selects", async () => {
  const synth = createFakeSynth({ voices: [] });
  const promise = loadVoicesWithRetry(synth, { timeoutMs: 500, intervalMs: 10 });
  synth.setVoices([voice("Carmit", "he-IL", true)]);
  synth.fireVoicesChanged();
  const voices = await promise;
  assert.equal(voices.length, 1);
  const pick = selectNatalieVoice(voices);
  assert.equal(pick?.voice.name, "Carmit");
});

test("resolves with empty list after timeout when voices never load", async () => {
  const synth = createFakeSynth({ voices: [] });
  const voices = await loadVoicesWithRetry(synth, { timeoutMs: 50, intervalMs: 10 });
  assert.deepEqual(voices, []);
});

test("waits for Hebrew voice even when non-Hebrew voices are reported first (Chrome Windows)", async () => {
  // כרום על Windows מדווח לפעמים קודם רק את קולות הרשת של Google (בלי עברית),
  // והקול העברי המקומי מגיע רק ב-voiceschanged מאוחר יותר.
  const synth = createFakeSynth({
    voices: [voice("Google US English", "en-US"), voice("Google UK English Female", "en-GB")],
  });
  const speaker = createSpeaker(synth, { loadVoicesOptions: { timeoutMs: 300, intervalMs: 10 } });
  const promise = speaker.speak("שלום");
  setTimeout(() => {
    synth.setVoices([
      voice("Google US English", "en-US"),
      voice("Google UK English Female", "en-GB"),
      voice("Microsoft Asaf - Hebrew (Israel)", "he-IL", true),
    ]);
    synth.fireVoicesChanged();
  }, 30);
  const result = await promise;
  assert.ok(result.ok);
  assert.equal(result.voiceName, "Microsoft Asaf - Hebrew (Israel)");
  assert.equal(result.lang, "he-IL");
});

// ── speak ──────────────────────────────────────────────────

test("speak succeeds with female Hebrew voice and sets utterance properties", async () => {
  const synth = createFakeSynth({
    voices: [
      voice("Microsoft Asaf - Hebrew (Israel)", "he-IL", true),
      voice("Microsoft Hila Online (Natural) - Hebrew (Israel)", "he-IL"),
    ],
  });
  const speaker = createSpeaker(synth);
  const result = await speaker.speak("שלום, הפגישה נקבעה ל-14:30");
  assert.ok(result.ok);
  assert.equal(result.voiceName, "Microsoft Hila Online (Natural) - Hebrew (Israel)");
  assert.equal(result.lang, "he-IL");
  const utterance = synth.spoken[0];
  assert.equal(utterance.lang, "he-IL");
  assert.equal(utterance.volume, 1);
  assert.equal(utterance.pitch, 1);
  assert.ok(utterance.text.includes("14:30"));
});

test("speak with empty voice list does not throw and does not report success", async () => {
  const synth = createFakeSynth({ voices: [], speakBehavior: "silent" });
  const speaker = createSpeaker(synth, { loadVoicesOptions: { timeoutMs: 30, intervalMs: 10 }, startTimeoutMs: 50 });
  const result = await speaker.speak("שלום");
  assert.equal(result.ok, false);
});

test("unsupported browser reports unsupported without throwing", async () => {
  const speaker = createSpeaker(null);
  const result = await speaker.speak("שלום");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "unsupported");
});

test("double speak does not create two overlapping utterances", async () => {
  const synth = createFakeSynth({ voices: [voice("Carmit", "he-IL", true)] });
  const speaker = createSpeaker(synth);
  const [first, second] = await Promise.all([
    speaker.speak("טקסט ראשון"),
    speaker.speak("טקסט שני"),
  ]);
  // הראשון מבוטל, השני מדבר — אין שתי הקראות פעילות במקביל.
  assert.equal(first.ok, false);
  assert.ok(second.ok);
  const started = synth.spoken.filter((u) => u.text.includes("שני"));
  assert.equal(started.length, 1);
});

test("previous speaking utterance is canceled before speaking new text", async () => {
  const synth = createFakeSynth({ voices: [voice("Carmit", "he-IL", true)] });
  const speaker = createSpeaker(synth);
  const first = await speaker.speak("הקראה ראשונה");
  assert.ok(first.ok);
  assert.equal(synth.speaking, true);
  const second = await speaker.speak("הקראה שנייה");
  assert.ok(second.ok);
  assert.ok(synth.calls.includes("cancel"), "expected cancel before the second utterance");
  assert.equal(synth.spoken[synth.spoken.length - 1].text, "הקראה שנייה");
});

test("resumes speechSynthesis when paused before speaking", async () => {
  const synth = createFakeSynth({ voices: [voice("Carmit", "he-IL", true)], paused: true });
  const speaker = createSpeaker(synth);
  const result = await speaker.speak("שלום");
  assert.ok(result.ok);
  assert.ok(synth.calls.indexOf("resume") < synth.calls.indexOf("speak"));
});

test("speak failure reports error so UI can leave loading state and offer retry", async () => {
  const synth = createFakeSynth({
    voices: [voice("Carmit", "he-IL", true)],
    speakBehavior: "error",
    errorCode: "not-allowed",
  });
  const speaker = createSpeaker(synth);
  const statuses: string[] = [];
  const result = await speaker.speak("שלום", { onStateChange: (s) => statuses.push(s) });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "blocked");
  assert.equal(speaker.getStatus(), "error");
  assert.ok(statuses.includes("loading"));
  assert.ok(!statuses.includes("speaking"));
});

test("silent block (no onstart) resolves as failure, not fake success", async () => {
  const synth = createFakeSynth({ voices: [voice("Carmit", "he-IL", true)], speakBehavior: "silent" });
  const speaker = createSpeaker(synth, { startTimeoutMs: 40 });
  const result = await speaker.speak("שלום");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "no-start");
});

test("stop cancels current speech and resets status", async () => {
  const synth = createFakeSynth({ voices: [voice("Carmit", "he-IL", true)] });
  const speaker = createSpeaker(synth);
  const result = await speaker.speak("שלום");
  assert.ok(result.ok);
  speaker.stop();
  assert.ok(synth.calls.includes("cancel"));
  assert.equal(speaker.getStatus(), "idle");
});

// ── טקסט מדובר ─────────────────────────────────────────────

test("buildSpokenText strips markdown, links and technical symbols but keeps Hebrew with numbers and times", () => {
  const raw = "**שלום שי!** הפגישה עם [שרית לוי](https://app.example.com/crm/123) נקבעה ל-14:30.\n- סעיף `אחד`\n- סעיף שניים\nראה https://example.com";
  const spoken = buildSpokenText(raw);
  assert.ok(spoken.includes("שלום שי!"));
  assert.ok(spoken.includes("שרית לוי"));
  assert.ok(spoken.includes("14:30"));
  assert.ok(spoken.includes("סעיף אחד"));
  assert.ok(!spoken.includes("**"));
  assert.ok(!spoken.includes("]("));
  assert.ok(!spoken.includes("https://"));
  assert.ok(!spoken.includes("`"));
});

test("spokenResponse-style plain text passes through unchanged", () => {
  const raw = "קבעתי לך פגישה עם דנה מחר בשעה 9:00.";
  assert.equal(buildSpokenText(raw), raw);
});
