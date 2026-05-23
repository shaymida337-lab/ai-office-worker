import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { handleWhatsAppCommand } from "../services/whatsapp.js";
import { config } from "../lib/config.js";

export const webhooksRouter = Router();

webhooksRouter.post("/twilio/whatsapp", async (req, res) => {
  const body = (req.body.Body as string) ?? "";
  const from = req.body.From as string;

  // MVP: first organization with Twilio configured
  const org = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!org) {
    res.status(200).send("<Response></Response>");
    return;
  }

  const reply = await handleWhatsAppCommand(org.id, body);

  const twilio = (await import("twilio")).default;
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);

  await prisma.whatsAppLog.create({
    data: {
      organizationId: org.id,
      direction: "inbound",
      body,
      fromNumber: from,
    },
  });

  res.type("text/xml").send(twiml.toString());
});
