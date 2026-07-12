import { Router } from "express";
import { config } from "../lib/config.js";
import { synthesizeSpeech } from "../services/natalieTts.js";
import {
  createAudioCache,
  createRateLimiter,
  DEMO_VOICE_TIMEOUT_MS,
  handleDemoVoiceRequest,
} from "../services/demoVoice/demoVoiceService.js";
import {
  buildNatalieVoiceCredentials,
  resolveNatalieVoiceSynthesizeProvider,
} from "./api.js";

/**
 * ‏POST /api/public/demo-voice — הקראת תשובות הדמו הציבורי בקול של נטלי.
 * ציבורי (בלי auth) אבל מוגבל: allowlist של תשובות דמו בלבד, rate-limit,
 * ‏cache ו-timeout. משתמש באותו ספק/voice/הגדרות של האפליקציה דרך
 * synthesizeSpeech — בלי לגעת במנגנון הקול של האפליקציה המחוברת.
 */

const cache = createAudioCache();
const limiter = createRateLimiter();

export const demoVoiceRouter = Router();

demoVoiceRouter.post("/demo-voice", async (req, res) => {
  const provider = resolveNatalieVoiceSynthesizeProvider(config.aiVoice.provider);
  if (!provider) {
    res.status(503).json({ error: "Voice service is not configured" });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const result = await handleDemoVoiceRequest(
    { id: (req.body as { id?: unknown })?.id, ip },
    {
      cache,
      limiter,
      synthesize: (text) =>
        synthesizeSpeech(
          { text, provider },
          buildNatalieVoiceCredentials(config.aiVoice),
          {
            fetchFn: (url, init) =>
              fetch(url, { ...init, signal: AbortSignal.timeout(DEMO_VOICE_TIMEOUT_MS) }),
          }
        ),
    }
  );

  if (result.kind === "error") {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.setHeader("Content-Type", result.contentType);
  // אודיו דמו קבוע וזהה לכולם — בטוח ל-cache ציבורי ארוך.
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("X-Demo-Voice-Cache", result.cacheHit ? "hit" : "miss");
  res.send(result.audio);
});
