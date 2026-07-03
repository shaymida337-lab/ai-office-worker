import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAnalyserRms,
  createInitialChunkVadState,
  createInitialVadTickState,
  evaluateChunkVadTick,
  evaluateVadTick,
  getVadConfig,
  getVadDeviceProfile,
  isIosSafari,
  isMobileVoiceDevice,
} from "./voiceRecordingVad.js";

const desktopConfig = getVadConfig("desktop");
const mobileConfig = getVadConfig("mobile");

test("mobile device detection includes iOS and Android", () => {
  assert.equal(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true);
  assert.equal(isMobileVoiceDevice("Mozilla/5.0 (Linux; Android 14) Mobile"), true);
  assert.equal(getVadDeviceProfile({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" }), "desktop");
});

test("desktop auto-stop triggers after speech then silence", () => {
  let state = createInitialVadTickState(1000);
  const speech = evaluateVadTick(0.05, 1100, state, desktopConfig);
  state = speech.nextState;
  assert.equal(speech.action, "continue");
  assert.equal(state.hasDetectedSpeech, true);

  const silentStart = evaluateVadTick(0.001, 1600, state, desktopConfig);
  state = silentStart.nextState;
  assert.equal(silentStart.action, "continue");
  assert.ok(silentStart.nextState.silenceStartedAt);

  const autoStop = evaluateVadTick(
    0.001,
    1600 + desktopConfig.silenceDurationMs,
    state,
    desktopConfig
  );
  assert.equal(autoStop.action, "stop_silence");
});

test("mobile auto-stop uses shorter silence window", () => {
  let state = createInitialVadTickState(0);
  state = evaluateVadTick(0.02, 100, state, mobileConfig).nextState;
  state = evaluateVadTick(0.001, 500, state, mobileConfig).nextState;
  const autoStop = evaluateVadTick(
    0.001,
    500 + mobileConfig.silenceDurationMs,
    state,
    mobileConfig
  );
  assert.equal(autoStop.action, "stop_silence");
});

test("max duration fallback stops long recordings", () => {
  const state = createInitialVadTickState(0);
  const result = evaluateVadTick(
    0.001,
    desktopConfig.maxRecordingMs + 1,
    state,
    desktopConfig
  );
  assert.equal(result.action, "stop_max_duration");
});

test("manual stop path is unaffected by VAD tick when still speaking", () => {
  let state = createInitialVadTickState(0);
  state = evaluateVadTick(0.04, 200, state, desktopConfig).nextState;
  const stillSpeaking = evaluateVadTick(0.03, 500, state, desktopConfig);
  assert.equal(stillSpeaking.action, "continue");
  assert.equal(stillSpeaking.nextState.silenceStartedAt, null);
});

test("chunk-based fallback auto-stop works for mobile-sized chunks", () => {
  let state = createInitialChunkVadState();
  state = evaluateChunkVadTick(2000, 100, state, mobileConfig).nextState;
  state = evaluateChunkVadTick(200, 400, state, mobileConfig).nextState;
  const autoStop = evaluateChunkVadTick(
    200,
    400 + mobileConfig.silenceDurationMs,
    state,
    mobileConfig
  );
  assert.equal(autoStop.action, "stop_silence");
});

test("computeAnalyserRms detects louder synthetic waveform", () => {
  const quiet = new Uint8Array(128).fill(128);
  const loud = new Uint8Array(128);
  for (let i = 0; i < loud.length; i++) {
    loud[i] = 128 + (i % 2 === 0 ? 40 : -40);
  }
  const analyser = {
    fftSize: 128,
    getByteTimeDomainData: (data: Uint8Array) => {
      data.set(quiet);
    },
  };
  const quietRms = computeAnalyserRms(analyser);
  analyser.getByteTimeDomainData = (data: Uint8Array) => {
    data.set(loud);
  };
  const loudRms = computeAnalyserRms(analyser);
  assert.ok(loudRms > quietRms);
});

test("silence detection does not stop before minimum speech duration", () => {
  let state = createInitialVadTickState(0);
  state = evaluateVadTick(0.04, 100, state, desktopConfig).nextState;
  const tooEarly = evaluateVadTick(0.001, 200, state, desktopConfig);
  assert.equal(tooEarly.action, "continue");
});

test("widget source no longer disables VAD on iOS", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../components/NatalieAssistantWidget.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /useVad\s*=\s*!isIosDevice\(\)/);
  assert.match(source, /getVadDeviceProfile/);
  assert.match(source, /evaluateChunkVadTick/);
});
