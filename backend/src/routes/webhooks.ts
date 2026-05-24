import { Router, type Request, type Response } from "express";
import twilio, { validateRequest } from "twilio";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import {
  findClientByWhatsAppNumber,
  findOrganizationByWhatsAppNumber,
  generateWhatsAppReply,
  handleWhatsAppCommand,
} from "../services/whatsapp.js";

export const webhooksRouter = Router();

async function handleTwilioWhatsApp(req: Request, res: Response) {
  const signature = req.header("X-Twilio-Signature") ?? "";
  if (
    config.twilio.authToken &&
    !validateRequest(config.twilio.authToken, signature, config.twilio.webhookUrl, req.body)
  ) {
    res.status(403).send("Invalid Twilio signature");
    return;
  }

  const body = (req.body.Body as string) ?? "";
  const from = req.body.From as string;
  const twiml = new twilio.twiml.MessagingResponse();
  const client = await findClientByWhatsAppNumber(from);

  if (client) {
    await prisma.whatsAppLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        direction: "inbound",
        body,
        fromNumber: from,
        toNumber: config.twilio.whatsappFrom,
      },
    });

    let reply = "תודה על הודעתך, נחזור אליך בקרוב";
    try {
      reply = await generateWhatsAppReply(body);
    } catch {
      reply = "תודה על הודעתך, נחזור אליך בקרוב";
    }

    twiml.message(reply);
    await prisma.whatsAppLog.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        direction: "outbound",
        body: reply,
        fromNumber: config.twilio.whatsappFrom,
        toNumber: from,
        aiGenerated: true,
        read: true,
      },
    });
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const organizationId = await findOrganizationByWhatsAppNumber(from);
  if (!organizationId) {
    twiml.message("מספר זה אינו רשום במערכת. פנה למנהל.");
    res.type("text/xml").send(twiml.toString());
    return;
  }

  const reply = await handleWhatsAppCommand(organizationId, body, from);
  twiml.message(reply);

  res.type("text/xml").send(twiml.toString());
}

webhooksRouter.post("/twilio/whatsapp", handleTwilioWhatsApp);
webhooksRouter.post("/whatsapp", handleTwilioWhatsApp);
