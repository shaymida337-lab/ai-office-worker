import { Router, type Request, type Response } from "express";
import twilio, { validateRequest } from "twilio";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  findClientByWhatsAppNumber,
  findOrCreateClientByWhatsAppNumber,
  normalizeWhatsAppNumber,
} from "../services/whatsapp.js";
import { handleClientMessage, handleOwnerMessage } from "../services/whatsappChatEngine.js";
import { analyzeAndSaveMessage } from "../services/messageScanner.js";

export const webhooksRouter = Router();

async function handleTwilioWhatsApp(req: Request, res: Response) {
  const signature = req.header("X-Twilio-Signature") ?? "";
  if (!config.twilio.authToken) {
    res.status(503).send("Twilio webhook is not configured");
    return;
  }

  if (!validateRequest(config.twilio.authToken, signature, config.twilio.webhookUrl, req.body)) {
    res.status(403).send("Invalid Twilio signature");
    return;
  }

  const body = (req.body.Body as string) ?? "";
  const from = req.body.From as string;
  const profileName = typeof req.body.ProfileName === "string" ? req.body.ProfileName : undefined;
  const twiml = new twilio.twiml.MessagingResponse();
  const normalizedFrom = normalizeWhatsAppNumber(from);
  const assistant = await findAssistantByOwnerPhone(normalizedFrom);

  if (assistant) {
    const inboundLog = await prisma.whatsAppLog.create({
      data: {
        organizationId: assistant.organizationId,
        direction: "inbound",
        body,
        fromNumber: normalizedFrom,
        toNumber: config.twilio.whatsappFrom,
      },
    });
    await scanWhatsAppMessage(assistant.organizationId, inboundLog.id, normalizedFrom, body, false);

    const reply = await safeReply(() => handleOwnerMessage(body, assistant.organizationId, normalizedFrom));
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
      },
    });
    await scanWhatsAppMessage(client.organizationId, inboundLog.id, normalizedFrom, body, false);

    const reply = await safeReply(() => handleClientMessage(body, client.id, client.organizationId, normalizedFrom));

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
      },
    });
    await scanWhatsAppMessage(organization.id, inboundLog.id, normalizedFrom, body, true);
    const reply = await safeReply(() => handleClientMessage(body, newClient.id, organization.id, normalizedFrom));
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

async function safeReply(run: () => Promise<string>) {
  try {
    return await run();
  } catch (err) {
    console.error("[webhook] WhatsApp assistant reply failed", err);
    return "תודה על ההודעה. הייתה תקלה רגעית, נסה שוב בעוד דקה.";
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
