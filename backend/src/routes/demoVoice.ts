import { Router } from "express";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { synthesizeSpeech } from "../services/natalieTts.js";
import {
  createAudioCache,
  createRateLimiter,
  DEMO_VOICE_TIMEOUT_MS,
  handleDemoVoiceRequest,
} from "../services/demoVoice/demoVoiceService.js";
import { handleMarketingLead } from "../services/marketingLeads/marketingLeadService.js";
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
// לידים: מגבלה הדוקה יותר — 5 שליחות לדקה לכל IP
const leadLimiter = createRateLimiter(5, 60_000);

export const demoVoiceRouter = Router();

demoVoiceRouter.post("/marketing-lead", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const result = await handleMarketingLead(
      { ...body, ip },
      {
        limiter: leadLimiter,
        createLead: (lead) => prisma.marketingLead.create({ data: lead, select: { id: true } }),
      }
    );
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[marketing-lead] unexpected", err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: "משהו השתבש — נסו שוב" });
  }
});

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
