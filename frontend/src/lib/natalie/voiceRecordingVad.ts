export type VadDeviceProfile = "desktop" | "mobile";

export type VadConfig = {
  silenceDurationMs: number;
  volumeThreshold: number;
  minSpeechMs: number;
  maxRecordingMs: number;
  checkIntervalMs: number;
  recorderTimesliceMs: number;
  fallbackMaxRecordingMs: number;
  speechChunkMinBytes: number;
  quietChunkMaxBytes: number;
  quietChunksForStop: number;
};

export type VadTickState = {
  recordingStartedAt: number;
  hasDetectedSpeech: boolean;
  speechStartedAt: number | null;
  silenceStartedAt: number | null;
};

export type VadTickAction = "continue" | "stop_silence" | "stop_max_duration";

export type ChunkVadState = {
  hasDetectedSpeech: boolean;
  speechStartedAt: number | null;
  silenceStartedAt: number | null;
  consecutiveQuietChunks: number;
};

const DESKTOP_VAD_CONFIG: VadConfig = {
  silenceDurationMs: 2500,
  volumeThreshold: 0.015,
  minSpeechMs: 400,
  maxRecordingMs: 30000,
  checkIntervalMs: 100,
  recorderTimesliceMs: 0,
  fallbackMaxRecordingMs: 30000,
  speechChunkMinBytes: 1200,
  quietChunkMaxBytes: 600,
  quietChunksForStop: 8,
};

const MOBILE_VAD_CONFIG: VadConfig = {
  silenceDurationMs: 1800,
  volumeThreshold: 0.009,
  minSpeechMs: 300,
  maxRecordingMs: 30000,
  checkIntervalMs: 80,
  recorderTimesliceMs: 250,
  fallbackMaxRecordingMs: 30000,
  speechChunkMinBytes: 900,
  quietChunkMaxBytes: 500,
  quietChunksForStop: 7,
};

export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Mac/i.test(userAgent) && maxTouchPoints > 1;
}

export function isMobileVoiceDevice(
  userAgent: string,
  maxTouchPoints = 0,
  innerWidth = 1024
): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  if (isIosSafari(userAgent, maxTouchPoints)) return true;
  return maxTouchPoints > 1 && innerWidth < 1024;
}

export function getVadDeviceProfile(input: {
  userAgent: string;
  maxTouchPoints?: number;
  innerWidth?: number;
}): VadDeviceProfile {
  return isMobileVoiceDevice(
    input.userAgent,
    input.maxTouchPoints ?? 0,
    input.innerWidth ?? 1024
  )
    ? "mobile"
    : "desktop";
}

export function getVadConfig(profile: VadDeviceProfile): VadConfig {
  return profile === "mobile" ? MOBILE_VAD_CONFIG : DESKTOP_VAD_CONFIG;
}

export function computeAnalyserRms(analyser: {
  fftSize: number;
  getByteTimeDomainData: (data: Uint8Array) => void;
}): number {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i]! - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / data.length);
}

export function createInitialVadTickState(now: number): VadTickState {
  return {
    recordingStartedAt: now,
    hasDetectedSpeech: false,
    speechStartedAt: null,
    silenceStartedAt: null,
  };
}

export function evaluateVadTick(
  rms: number,
  now: number,
  state: VadTickState,
  config: VadConfig
): { action: VadTickAction; nextState: VadTickState } {
  const nextState: VadTickState = { ...state };

  if (rms > config.volumeThreshold) {
    if (!nextState.hasDetectedSpeech) {
      nextState.hasDetectedSpeech = true;
      nextState.speechStartedAt = now;
    }
    nextState.silenceStartedAt = null;
  } else if (
    nextState.hasDetectedSpeech &&
    nextState.speechStartedAt !== null &&
    now - nextState.speechStartedAt >= config.minSpeechMs
  ) {
    if (nextState.silenceStartedAt === null) {
      nextState.silenceStartedAt = now;
    } else if (now - nextState.silenceStartedAt >= config.silenceDurationMs) {
      return { action: "stop_silence", nextState };
    }
  }

  if (now - nextState.recordingStartedAt >= config.maxRecordingMs) {
    return { action: "stop_max_duration", nextState };
  }

  return { action: "continue", nextState };
}

export function createInitialChunkVadState(): ChunkVadState {
  return {
    hasDetectedSpeech: false,
    speechStartedAt: null,
    silenceStartedAt: null,
    consecutiveQuietChunks: 0,
  };
}

export function evaluateChunkVadTick(
  chunkSize: number,
  now: number,
  state: ChunkVadState,
  config: VadConfig
): { action: VadTickAction; nextState: ChunkVadState } {
  const nextState: ChunkVadState = { ...state };

  if (chunkSize >= config.speechChunkMinBytes) {
    if (!nextState.hasDetectedSpeech) {
      nextState.hasDetectedSpeech = true;
      nextState.speechStartedAt = now;
    }
    nextState.consecutiveQuietChunks = 0;
    nextState.silenceStartedAt = null;
    return { action: "continue", nextState };
  }

  if (!nextState.hasDetectedSpeech) {
    return { action: "continue", nextState };
  }

  if (
    nextState.speechStartedAt !== null &&
    now - nextState.speechStartedAt < config.minSpeechMs
  ) {
    return { action: "continue", nextState };
  }

  if (chunkSize <= config.quietChunkMaxBytes) {
    nextState.consecutiveQuietChunks += 1;
    if (nextState.silenceStartedAt === null) {
      nextState.silenceStartedAt = now;
    }
    const quietDurationMs =
      nextState.silenceStartedAt !== null ? now - nextState.silenceStartedAt : 0;
    if (
      nextState.consecutiveQuietChunks >= config.quietChunksForStop ||
      quietDurationMs >= config.silenceDurationMs
    ) {
      return { action: "stop_silence", nextState };
    }
  } else {
    nextState.consecutiveQuietChunks = 0;
    nextState.silenceStartedAt = null;
  }

  return { action: "continue", nextState };
}

export function shouldUseRecorderTimeslice(config: VadConfig): number | undefined {
  return config.recorderTimesliceMs > 0 ? config.recorderTimesliceMs : undefined;
}
