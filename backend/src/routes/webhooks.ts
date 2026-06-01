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
import { classifyJunk, shouldAutoClassifyAfterJunkFilter } from "../services/classification/junkFilter.js";
import { recordFinancialDocumentDecision } from "../services/financialDocuments.js";

export const webhooksRouter = Router();

function whatsappWebhookHealth(_req: Request, res: Response) {
  const configuration = getWhatsAppConfigurationStatus();
  res.status(configuration.configured ? 200 : 503).json({
    provider: configuration.provider,
    configured: configuration.configured,
    missingVariables: configuration.missingVariables,
    envDiagnostics: configuration.envDiagnostics,
    messageProcessingEnabled: configuration.messageProcessingEnabled,
    mediaIngestionEnabled: configuration.mediaIngestionEnabled,
    autoReplyEnabled: configuration.autoReplyEnabled,
    createClientsEnabled: configuration.createClientsEnabled,
    webEnabled: configuration.webEnabled,
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

  const body = (req.body.Body as string) ?? "";
  const from = req.body.From as string;
  const to = req.body.To as string;
  const media = parseTwilioMedia(req.body as Record<string, unknown>);
  const messageSid = typeof req.body.MessageSid === "string" ? req.body.MessageSid : "unknown";
  const profileName = typeof req.body.ProfileName === "string" ? req.body.ProfileName : undefined;
  const normalizedFrom = normalizeWhatsAppNumber(from);
  const normalizedTo = normalizeWhatsAppNumber(to || config.twilio.whatsappFrom);
  console.log("[webhook] WhatsApp message received", {
    sid: messageSid,
    from: normalizedFrom,
    to: normalizedTo,
    configuredSandboxNumber: config.twilio.whatsappFrom,
    mediaCount: media.length,
    bodyPreview: body.slice(0, 240),
    processingEnabled: config.twilio.messageProcessingEnabled,
    mediaIngestionEnabled: config.twilio.mediaIngestionEnabled,
    autoReplyEnabled: config.twilio.autoReplyEnabled,
    createClientsEnabled: config.twilio.createClientsEnabled,
    path: req.originalUrl,
  });

  if (!config.twilio.messageProcessingEnabled) {
    res.type("text/xml").send(new twilio.twiml.MessagingResponse().toString());
    return;
  }

  const twiml = new twilio.twiml.MessagingResponse();
  const configuredSandboxNumber = normalizeWhatsAppNumber(config.twilio.whatsappFrom);
  if (normalizedTo !== configuredSandboxNumber) {
    console.log("[webhook] WhatsApp inbound ignored because it was not sent to the configured Twilio Sandbox number", {
      sid: messageSid,
      from: normalizedFrom,
      to: normalizedTo,
      configuredSandboxNumber,
    });
    res.type("text/xml").send(twiml.toString());
    return;
  }
  const assistant = await findAssistantByOwnerPhone(normalizedFrom);
  console.log(`[webhook] WhatsApp inbound accepted sid=${messageSid} from=${normalizedFrom} media=${media.length} path=${req.originalUrl}`);

  if (assistant) {
    const inboundLog = await createInboundWhatsAppLogOnce({
      organizationId: assistant.organizationId,
      body,
      fromNumber: normalizedFrom,
      toNumber: config.twilio.whatsappFrom,
      providerMessageSid: messageSid,
      mediaCount: media.length,
      mediaJson: media,
    });
    if (inboundLog.duplicate) {
      res.type("text/xml").send(twiml.toString());
      return;
    }
    if (!(await shouldContinueAfterWhatsAppJunkGate({
      organizationId: assistant.organizationId,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    }))) {
      res.type("text/xml").send(twiml.toString());
      return;
    }
    await scanWhatsAppMessage(assistant.organizationId, inboundLog.id, normalizedFrom, body, false);
    const mediaResult = config.twilio.mediaIngestionEnabled ? await safeMediaIngestion({
      organizationId: assistant.organizationId,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    }) : { reply: null };

    if (config.twilio.autoReplyEnabled) {
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
    }
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const client = await findClientByWhatsAppNumber(normalizedFrom);
  if (client) {
    if (await hasProcessedInboundWhatsAppMessage(client.organizationId, messageSid)) {
      console.log("[webhook] WhatsApp duplicate webhook skipped", {
        organizationId: client.organizationId,
        sid: messageSid,
      });
      res.type("text/xml").send(twiml.toString());
      return;
    }
    await prisma.client.update({
      where: { id: client.id },
      data: { lastSeen: new Date(), whatsappNumber: client.whatsappNumber ?? normalizedFrom },
    });
    const inboundLog = await createInboundWhatsAppLogOnce({
      organizationId: client.organizationId,
      clientId: client.id,
      body,
      fromNumber: normalizedFrom,
      toNumber: config.twilio.whatsappFrom,
      providerMessageSid: messageSid,
      mediaCount: media.length,
      mediaJson: media,
    });
    if (inboundLog.duplicate) {
      res.type("text/xml").send(twiml.toString());
      return;
    }
    if (!(await shouldContinueAfterWhatsAppJunkGate({
      organizationId: client.organizationId,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    }))) {
      res.type("text/xml").send(twiml.toString());
      return;
    }
    await scanWhatsAppMessage(client.organizationId, inboundLog.id, normalizedFrom, body, false);
    const mediaResult = config.twilio.mediaIngestionEnabled ? await safeMediaIngestion({
      organizationId: client.organizationId,
      clientId: client.id,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    }) : { reply: null };

    if (config.twilio.autoReplyEnabled) {
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
    }
    res.type("text/xml").send(twiml.toString());
    return;
  }

  if (!config.twilio.createClientsEnabled) {
    console.log("[webhook] WhatsApp inbound ignored because client creation is disabled", {
      sid: messageSid,
      from: normalizedFrom,
      to: normalizedTo,
    });
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (organization) {
    if (await hasProcessedInboundWhatsAppMessage(organization.id, messageSid)) {
      console.log("[webhook] WhatsApp duplicate webhook skipped", {
        organizationId: organization.id,
        sid: messageSid,
      });
      res.type("text/xml").send(twiml.toString());
      return;
    }
    const inboundLog = await createInboundWhatsAppLogOnce({
      organizationId: organization.id,
      body,
      fromNumber: normalizedFrom,
      toNumber: config.twilio.whatsappFrom,
      providerMessageSid: messageSid,
      mediaCount: media.length,
      mediaJson: media,
    });
    if (inboundLog.duplicate) {
      res.type("text/xml").send(twiml.toString());
      return;
    }
    if (!(await shouldContinueAfterWhatsAppJunkGate({
      organizationId: organization.id,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    }))) {
      res.type("text/xml").send(twiml.toString());
      return;
    }
    const { client: newClient, created } = await findOrCreateClientByWhatsAppNumber(organization.id, normalizedFrom, profileName);
    await prisma.whatsAppLog.update({
      where: { id: inboundLog.id },
      data: { clientId: newClient.id },
    });
    await scanWhatsAppMessage(organization.id, inboundLog.id, normalizedFrom, body, true);
    const mediaResult = config.twilio.mediaIngestionEnabled ? await safeMediaIngestion({
      organizationId: organization.id,
      clientId: newClient.id,
      whatsappLogId: inboundLog.id,
      fromNumber: normalizedFrom,
      body,
      media,
    }) : { reply: null };
    if (config.twilio.autoReplyEnabled) {
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
    }
    res.type("text/xml").send(twiml.toString());
    return;
  }

  res.type("text/xml").send(twiml.toString());
}

async function findAssistantByOwnerPhone(phone: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ organizationId: string }>>(
    'SELECT "organizationId" FROM "WhatsAppAssistant" WHERE "ownerPhone" = $1 AND "isActive" = true LIMIT 1',
    phone
  );
  return rows[0] ?? null;
}

type InboundWhatsAppLogInput = {
  organizationId: string;
  clientId?: string | null;
  body: string;
  fromNumber: string;
  toNumber: string;
  providerMessageSid: string;
  mediaCount: number;
  mediaJson: unknown;
};

type WhatsAppLogStore = {
  whatsAppLog: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

export async function createInboundWhatsAppLogOnce(input: InboundWhatsAppLogInput, db: WhatsAppLogStore = prisma) {
  const existing = await findProcessedInboundWhatsAppMessage(input.organizationId, input.providerMessageSid, db);
  if (existing) {
    console.log("[webhook] WhatsApp duplicate webhook skipped", {
      organizationId: input.organizationId,
      sid: input.providerMessageSid,
      existingLogId: existing.id,
    });
    return { id: existing.id, duplicate: true, created: false };
  }

  const created = await db.whatsAppLog.create({
    data: {
      organizationId: input.organizationId,
      clientId: input.clientId ?? undefined,
      direction: "inbound",
      body: input.body,
      fromNumber: input.fromNumber,
      toNumber: input.toNumber,
      providerMessageSid: input.providerMessageSid,
      mediaCount: input.mediaCount,
      mediaJson: input.mediaJson,
    },
    select: { id: true },
  });
  return { id: created.id, duplicate: false, created: true };
}

export async function hasProcessedInboundWhatsAppMessage(organizationId: string, providerMessageSid: string, db: WhatsAppLogStore = prisma) {
  return Boolean(await findProcessedInboundWhatsAppMessage(organizationId, providerMessageSid, db));
}

async function shouldContinueAfterWhatsAppJunkGate(input: {
  organizationId: string;
  whatsappLogId: string;
  fromNumber: string;
  body: string;
  media: Array<{ filename?: string | null; contentType: string; url: string }>;
}) {
  const decision = classifyJunk({
    sender: input.fromNumber,
    subject: input.body.slice(0, 120),
    body: input.body,
    channel: "whatsapp",
    attachmentFilenames: input.media.map((item) => item.filename).filter(Boolean) as string[],
    metadata: { whatsappLogId: input.whatsappLogId, mediaCount: input.media.length },
  });

  if (decision.bucket === "CERTAIN_JUNK") {
    console.log("[webhook] WhatsApp junk dropped", {
      organizationId: input.organizationId,
      whatsappLogId: input.whatsappLogId,
      reason: decision.reason,
    });
    return false;
  }

  if (!shouldAutoClassifyAfterJunkFilter(decision)) {
    console.log("[webhook] WhatsApp junk needs_review", {
      organizationId: input.organizationId,
      whatsappLogId: input.whatsappLogId,
      reason: decision.reason,
      blocklisted: decision.blocklisted,
    });
    await recordFinancialDocumentDecision({
      organizationId: input.organizationId,
      source: "whatsapp",
      sender: input.fromNumber,
      subject: input.body.slice(0, 240),
      fileName: input.media[0]?.filename ?? null,
      fileSize: null,
      supplierName: input.fromNumber,
      supplierTaxId: null,
      invoiceNumber: null,
      documentDate: new Date(),
      dueDate: null,
      amountBeforeVat: null,
      vatAmount: null,
      totalAmount: null,
      documentType: "payment_request",
      driveFileUrl: null,
      confidenceScore: 0,
      uncertaintyReason: `junk_filter:${decision.reason}`,
      rawAnalysis: { junkDecision: decision, whatsappLogId: input.whatsappLogId },
      whatsappLogId: input.whatsappLogId,
    });
    return false;
  }

  return true;
}

async function findProcessedInboundWhatsAppMessage(organizationId: string, providerMessageSid: string, db: WhatsAppLogStore) {
  if (!isUsableProviderMessageSid(providerMessageSid)) return null;
  return db.whatsAppLog.findFirst({
    where: {
      organizationId,
      direction: "inbound",
      providerMessageSid,
    },
    select: { id: true },
  });
}

function isUsableProviderMessageSid(value: string | null | undefined) {
  const sid = value?.trim();
  return Boolean(sid && sid !== "unknown");
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
    console.log("[webhook] WhatsApp media ingestion done", {
      logId: input.whatsappLogId,
      processed: result.processed.length,
      skipped: result.skipped,
      paymentIds: result.processed.map((item) => item.paymentId).filter(Boolean),
      invoiceIds: result.processed.map((item) => item.invoiceId).filter(Boolean),
      driveLinks: result.processed.map((item) => item.driveLink).filter(Boolean),
    });
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
