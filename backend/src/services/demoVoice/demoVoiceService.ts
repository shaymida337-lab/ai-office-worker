import type { SynthesizeResult } from "../natalieTts.js";
import { getDemoVoiceText } from "./demoVoiceCatalog.js";

/**
 * שירות הקול של הדמו הציבורי — עוטף את synthesizeSpeech הקיים (אותו ספק,
 * אותו voice ID ואותן הגדרות של האפליקציה) בהגנות: allowlist לפי id,
 * ‏rate-limit לפי IP, ‏cache בזיכרון (לא משלמים פעמיים על אותה תשובה),
 * ‏timeout, ומדידה ללא PII. אין כאן שמירת אודיו אישי — רק תשובות דמו קבועות.
 */

export const DEMO_VOICE_RATE_LIMIT = 20; // בקשות לחלון לכל IP
export const DEMO_VOICE_RATE_WINDOW_MS = 60_000;
export const DEMO_VOICE_TIMEOUT_MS = 10_000;

export function createRateLimiter(
  limit = DEMO_VOICE_RATE_LIMIT,
  windowMs = DEMO_VOICE_RATE_WINDOW_MS
) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now = Date.now()): boolean {
      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // ניקוי מפתחות ישנים כדי שהמפה לא תגדל בלי סוף
      if (hits.size > 10_000) {
        for (const [k, times] of hits) {
          if (times.every((t) => t <= windowStart)) hits.delete(k);
        }
      }
      return true;
    },
  };
}

export type CachedAudio = { audio: Buffer; contentType: string };

export function createAudioCache() {
  // הקטלוג קטן וקבוע — cache לפי id בטוח וחסום-גודל מטבעו.
  const entries = new Map<string, CachedAudio>();
  return {
    get: (id: string) => entries.get(id) ?? null,
    set: (id: string, value: CachedAudio) => {
      entries.set(id, value);
    },
    size: () => entries.size,
  };
}

export type DemoVoiceDeps = {
  synthesize: (text: string) => Promise<SynthesizeResult>;
  cache: ReturnType<typeof createAudioCache>;
  limiter: ReturnType<typeof createRateLimiter>;
  log?: (event: Record<string, unknown>) => void;
};

export type DemoVoiceResponse =
  | { kind: "audio"; audio: Buffer; contentType: string; cacheHit: boolean }
  | { kind: "error"; status: number; error: string };

export async function handleDemoVoiceRequest(
  input: { id?: unknown; ip: string },
  deps: DemoVoiceDeps
): Promise<DemoVoiceResponse> {
  const log = deps.log ?? ((event) => console.log("[demoVoice]", JSON.stringify(event)));

  const id = typeof input.id === "string" ? input.id.trim() : "";
  const text = id ? getDemoVoiceText(id) : null;
  if (!text) {
    // לא endpoint חופשי: id שאינו בקטלוג נdeny — בלי להדהד קלט של המשתמש.
    log({ event: "demo_voice_rejected", reason: "unknown_id" });
    return { kind: "error", status: 400, error: "Unknown demo reply id" };
  }

  if (!deps.limiter.allow(input.ip)) {
    log({ event: "demo_voice_rate_limited" });
    return { kind: "error", status: 429, error: "Too many requests" };
  }

  const cached = deps.cache.get(id);
  if (cached) {
    log({ event: "demo_voice_served", id, cacheHit: true });
    return { kind: "audio", audio: cached.audio, contentType: cached.contentType, cacheHit: true };
  }

  const startedAt = Date.now();
  let result: SynthesizeResult;
  try {
    result = await deps.synthesize(text);
  } catch (err) {
    log({
      event: "demo_voice_error",
      id,
      reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "exception",
      durationMs: Date.now() - startedAt,
    });
    return { kind: "error", status: 502, error: "Voice generation failed" };
  }

  if (!result.ok) {
    log({ event: "demo_voice_error", id, status: result.status, durationMs: Date.now() - startedAt });
    return { kind: "error", status: result.status === 503 ? 503 : 502, error: "Voice unavailable" };
  }

  deps.cache.set(id, { audio: result.audio, contentType: result.contentType });
  log({
    event: "demo_voice_served",
    id,
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    bytes: result.audio.length,
  });
  return { kind: "audio", audio: result.audio, contentType: result.contentType, cacheHit: false };
}
