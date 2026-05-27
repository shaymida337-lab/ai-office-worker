import { Router, type Request, type Response } from "express";
import twilio, { validateRequest } from "twilio";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  findClientByWhatsAppNumber,
  normalizeWhatsAppNumber,
} from "../services/whatsapp.js";
import { handleClientMessage, handleOwnerMessage } from "../services/whatsappChatEngine.js";

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
  const twiml = new twilio.twiml.MessagingResponse();
  const normalizedFrom = normalizeWhatsAppNumber(from);
  const assistant = await findAssistantByOwnerPhone(normalizedFrom);

  if (assistant) {
    await prisma.whatsAppLog.create({
      data: {
        organizationId: assistant.organizationId,
        direction: "inbound",
        body,
        fromNumber: normalizedFrom,
        toNumber: config.twilio.whatsappFrom,
      },
    });

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
    await prisma.whatsAppLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        direction: "inbound",
        body,
        fromNumber: normalizedFrom,
        toNumber: config.twilio.whatsappFrom,
      },
    });

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
    const { createLeadFromUnknownWhatsApp } = await import("../services/crm.js");
    await createLeadFromUnknownWhatsApp(organization.id, normalizedFrom, body);
    twiml.message("שלום! תודה שפנית אלינו. קיבלנו את ההודעה ונציג יחזור אליך בהקדם.");
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

webhooksRouter.post("/twilio/whatsapp", handleTwilioWhatsApp);
webhooksRouter.post("/whatsapp", handleTwilioWhatsApp);
