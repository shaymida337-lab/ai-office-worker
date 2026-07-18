const VOICE_DEBUG_PREFIX = "[natalie][voice-debug]";
const MAX_VOICE_DEBUG_ENTRIES = 200;

export type VoiceDebugEvent =
  | "session_start"
  | "media_recorder_started"
  | "audio_context_created"
  | "audio_context_resumed"
  | "audio_context_unavailable"
  | "analyser_created"
  | "analyser_failed"
  | "vad_monitoring_started"
  | "vad_tick_skipped"
  | "rms_sample"
  | "speech_detected"
  | "silence_timer_started"
  | "silence_timer_cancelled"
  | "chunk_fallback_enabled"
  | "chunk_received"
  | "chunk_speech_detected"
  | "chunk_silence_timer_started"
  | "auto_stop_requested"
  | "stop_requested"
  | "recorder_stop_called"
  | "recorder_onstop_fired"
  | "transcription_started"
  | "transcription_skipped_duplicate"
  | "fallback_max_timer_scheduled";

export type VoiceDebugLogEntry = {
  id: string;
  event: VoiceDebugEvent;
  at: string;
  rms?: number;
  threshold?: number;
  recorderState?: string;
  audioContextState?: string;
  chunkSize?: number;
  trigger?: string;
  raw: Record<string, unknown>;
};

const voiceDebugEntries: VoiceDebugLogEntry[] = [];
const voiceDebugListeners = new Set<() => void>();

function notifyVoiceDebugListeners() {
  for (const listener of voiceDebugListeners) {
    listener();
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeVoiceDebugEntry(
  event: VoiceDebugEvent,
  payload: Record<string, unknown>
): VoiceDebugLogEntry {
  const at = asString(payload.at) ?? new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event,
    at,
    rms: asNumber(payload.rms),
    threshold: asNumber(payload.threshold),
    recorderState: asString(payload.recorderState),
    audioContextState: asString(payload.audioContextState) ?? asString(payload.state),
    chunkSize: asNumber(payload.chunkSize),
    trigger: asString(payload.trigger),
    raw: payload,
  };
}

/** Explicit opt-in only (`?voiceDebug=1`). Never auto-show in normal UI. */
export function isVoiceDebugPanelEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("voiceDebug") === "1";
}

export function getVoiceDebugEntries(): VoiceDebugLogEntry[] {
  return [...voiceDebugEntries];
}

export function clearVoiceDebugEntries() {
  voiceDebugEntries.length = 0;
  notifyVoiceDebugListeners();
}

export function subscribeVoiceDebugEntries(listener: () => void): () => void {
  voiceDebugListeners.add(listener);
  return () => {
    voiceDebugListeners.delete(listener);
  };
}

export function formatVoiceDebugLogsForCopy(entries: VoiceDebugLogEntry[] = voiceDebugEntries): string {
  return entries
    .map((entry) => {
      const payload = {
        at: entry.at,
        ...entry.raw,
      };
      return `${VOICE_DEBUG_PREFIX} ${entry.event} ${JSON.stringify(payload)}`;
    })
    .join("\n");
}

export function logVoiceDebug(
  event: VoiceDebugEvent,
  payload: Record<string, unknown> = {}
): void {
  const enrichedPayload = {
    at: new Date().toISOString(),
    ...payload,
  };

  if (typeof console !== "undefined") {
    console.log(VOICE_DEBUG_PREFIX, event, enrichedPayload);
  }

  if (!isVoiceDebugPanelEnabled()) return;

  if (event === "session_start") {
    voiceDebugEntries.length = 0;
  }

  voiceDebugEntries.push(normalizeVoiceDebugEntry(event, enrichedPayload));
  if (voiceDebugEntries.length > MAX_VOICE_DEBUG_ENTRIES) {
    voiceDebugEntries.shift();
  }
  notifyVoiceDebugListeners();
}

export function shouldLogPeriodicSample(tick: number, every = 6): boolean {
  return tick > 0 && tick % every === 0;
}
