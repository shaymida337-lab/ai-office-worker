import { Router, type Request, type Response } from "express";
import twilio, { validateRequest } from "twilio";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  findClientByWhatsAppNumber,
  findOrCreateClientByWhatsAppNumber,
  getWhatsAppConfigurationStatus,
  normalizeWhatsAppNumber,
} from "../services/whatsapp.js";
import { handleClientMessage, handleOwnerMessage } from "../services/whatsappChatEngine.js";
import { analyzeAndSaveMessage } from "../services/messageScanner.js";
import { ingestWhatsAppInvoiceMedia, parseTwilioMedia } from "../services/whatsappInvoiceIngestion.js";

export const webhooksRouter = Router();

function whatsappWebhookHealth(_req: Request, res: Response) {
  const configuration = getWhatsAppConfigurationStatus();
  res.status(configuration.configured ? 200 : 503).json({
    provider: configuration.provider,
    configured: configuration.configured,
    missingVariables: configuration.missingVariables,
    envDiagnostics: configuration.envDiagnostics,
    messageProcessingEnabled: configuration.messageProcessingEnabled,
    webhookUrl: configuration.webhookUrl,
    webhookUrls: configuration.webhookUrls,
    inboundMethod: "POST",
    message: configuration.configured
      ? "WhatsApp webhook endpoint is registered"
      : `WhatsApp configuration missing: ${configuration.missingVariables.join(", ")}`,
  });
}

async function handleTwilioWhatsApp(req: Request, res: Response) {
  const signature = req.header("X-Twilio-Signature") ?? "";
  if (!config.twilio.authToken) {
    res.status(503).send("Twilio webhook is not configured");
    return;
  }

  if (!isValidTwilioSignature(req, signature)) {
    res.status(403).send("Invalid Twilio signature");
    return;
  }

  if (!config.twilio.messageProcessingEnabled) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("תודה, ההודעה התקבלה. בשלב זה המערכת לא קוראת הודעות WhatsApp ולא אוספת חשבוניות מ-WhatsApp.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const body = (req.body.Body as string) ?? "";
  const from = req.body.From as string;
  const media = parseTwilioMedia(req.body as Record<string, unknown>);
  const messageSid = typeof req.body.MessageSid === "string" ? req.body.MessageSid : "unknown";
  const profileName = typeof req.body.ProfileName === "string" ? req.body.ProfileName : undefined;
  const twiml = new twilio.twiml.MessagingResponse();
  const normalizedFrom = normalizeWhatsAppNumber(from);
  const assistant = await findAssistantByOwnerPhone(normalizedFrom);
  console.log(`[webhook] WhatsApp inbound sid=${messageSid} from=${normalizedFrom} media=${media.length} path=${req.originalUrl}`);

  if (assistant) {
    const inboundLog = await prisma.whatsAppLog.create({
      data: {
        organizationId: assistant.organizationId,
        direction: "inbound",
        body,
        fromNumber: normalizedFrom,
        toNumber: config.twilio.whatsappFrom,
        providerMessageSid: messageSid,
        mediaCount: media.length,
        mediaJson: media,
      },
    });
    await scanWhatsAppMessage(assistant.organizationId, inboundLog.id, normalizedFrom, body, false);
    const mediaResult = await safeMediaIngestion({
      organizationId: assistant.organizationId,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    });

    const reply = mediaResult.reply ?? await safeReply(() => handleOwnerMessage(body, assistant.organizationId, normalizedFrom));
    twiml.message(reply);
    await prisma.whatsAppLog.create({
      data: {
        organizationId: assistant.organizationId,
        direction: "outbound",
        body: reply,
        fromNumber: config.twilio.whatsappFrom,
        toNumber: normalizedFrom,
        aiGenerated: true,
        read: true,
      },
    });
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const client = await findClientByWhatsAppNumber(normalizedFrom);
  if (client) {
    await prisma.client.update({
      where: { id: client.id },
      data: { lastSeen: new Date(), whatsappNumber: client.whatsappNumber ?? normalizedFrom },
    });
    const inboundLog = await prisma.whatsAppLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        direction: "inbound",
        body,
        fromNumber: normalizedFrom,
        toNumber: config.twilio.whatsappFrom,
        providerMessageSid: messageSid,
        mediaCount: media.length,
        mediaJson: media,
      },
    });
    await scanWhatsAppMessage(client.organizationId, inboundLog.id, normalizedFrom, body, false);
    const mediaResult = await safeMediaIngestion({
      organizationId: client.organizationId,
      clientId: client.id,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    });

    const reply = mediaResult.reply ?? await safeReply(() => handleClientMessage(body, client.id, client.organizationId, normalizedFrom));

    twiml.message(reply);
    await prisma.whatsAppLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        direction: "outbound",
        body: reply,
        fromNumber: config.twilio.whatsappFrom,
        toNumber: normalizedFrom,
        aiGenerated: true,
        read: true,
      },
    });
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (organization) {
    const { client: newClient, created } = await findOrCreateClientByWhatsAppNumber(organization.id, normalizedFrom, profileName);
    const inboundLog = await prisma.whatsAppLog.create({
      data: {
        organizationId: organization.id,
        clientId: newClient.id,
        direction: "inbound",
        body,
        fromNumber: normalizedFrom,
        toNumber: config.twilio.whatsappFrom,
        providerMessageSid: messageSid,
        mediaCount: media.length,
        mediaJson: media,
      },
    });
    await scanWhatsAppMessage(organization.id, inboundLog.id, normalizedFrom, body, true);
    const mediaResult = await safeMediaIngestion({
      organizationId: organization.id,
      clientId: newClient.id,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    });
    const reply = mediaResult.reply ?? await safeReply(() => handleClientMessage(body, newClient.id, organization.id, normalizedFrom));
    twiml.message(created ? `שלום ${newClient.name}, קיבלנו את ההודעה ונפתח לך כרטיס לקוח במערכת.\n${reply}` : reply);
    await prisma.whatsAppLog.create({
      data: {
        organizationId: organization.id,
        clientId: newClient.id,
        direction: "outbound",
        body: created ? `שלום ${newClient.name}, קיבלנו את ההודעה ונפתח לך כרטיס לקוח במערכת.\n${reply}` : reply,
        fromNumber: config.twilio.whatsappFrom,
        toNumber: normalizedFrom,
        aiGenerated: true,
        read: true,
      },
    });
    res.type("text/xml").send(twiml.toString());
    return;
  }

  twiml.message("שלום! מספר זה אינו רשום במערכת. פנה למנהל.");
  res.type("text/xml").send(twiml.toString());
}

async function findAssistantByOwnerPhone(phone: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ organizationId: string }>>(
    'SELECT "organizationId" FROM "WhatsAppAssistant" WHERE "ownerPhone" = $1 AND "isActive" = true LIMIT 1',
    phone
  );
  return rows[0] ?? null;
}

function isValidTwilioSignature(req: Request, signature: string) {
  if (!config.twilio.authToken) return false;
  const protocol = String(req.headers["x-forwarded-proto"] ?? req.protocol ?? "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const requestUrl = host ? `${protocol}://${host}${req.originalUrl}` : config.twilio.webhookUrl;
  const candidates = Array.from(new Set([
    config.twilio.webhookUrl,
    requestUrl,
    requestUrl.replace("/api/webhook/", "/webhook/"),
    requestUrl.replace("/webhook/", "/api/webhook/"),
  ]));
  return candidates.some((url) => validateRequest(config.twilio.authToken!, signature, url, req.body));
}

async function safeReply(run: () => Promise<string>) {
  try {
    return await run();
  } catch (err) {
    console.error("[webhook] WhatsApp assistant reply failed", err);
    return "תודה על ההודעה. הייתה תקלה רגעית, נסה שוב בעוד דקה.";
  }
}

async function safeMediaIngestion(input: Parameters<typeof ingestWhatsAppInvoiceMedia>[0]) {
  if (!input.media.length) return { processed: [], skipped: 0, reply: null };
  try {
    console.log(`[webhook] WhatsApp media ingestion start logId=${input.whatsappLogId} media=${input.media.length}`);
    const result = await ingestWhatsAppInvoiceMedia(input);
    console.log(`[webhook] WhatsApp media ingestion done logId=${input.whatsappLogId} processed=${result.processed.length} skipped=${result.skipped}`);
    return result;
  } catch (err) {
    console.error("[webhook] WhatsApp invoice media ingestion failed", err);
    return {
      processed: [],
      skipped: input.media.length,
      reply: "קיבלתי את הקובץ, אבל הייתה תקלה בשמירה או חילוץ הנתונים. נסה לשלוח שוב בעוד רגע.",
    };
  }
}

async function scanWhatsAppMessage(organizationId: string, logId: string, phone: string, body: string, createLead: boolean) {
  await analyzeAndSaveMessage({
    organizationId,
    channel: "whatsapp",
    externalId: logId,
    whatsappLogId: logId,
    senderPhone: phone,
    bodyText: body,
    occurredAt: new Date(),
    createLead,
  }).catch((err) => {
    console.warn("[webhook] WhatsApp intelligence scan failed", err instanceof Error ? err.message : String(err));
  });
}

webhooksRouter.post("/twilio/whatsapp", handleTwilioWhatsApp);
webhooksRouter.post("/whatsapp", handleTwilioWhatsApp);
webhooksRouter.get("/twilio/whatsapp", whatsappWebhookHealth);
webhooksRouter.get("/whatsapp", whatsappWebhookHealth);
