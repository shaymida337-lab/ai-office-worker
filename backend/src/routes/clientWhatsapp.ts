import { Router } from "express";
import { authMiddleware } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { clientWhatsApp } from "../services/clientWhatsApp.js";

export const clientWhatsappRouter = Router();
clientWhatsappRouter.use(authMiddleware);

clientWhatsappRouter.use("/:clientId/whatsapp", async (req, res, next) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, organizationId: req.auth!.organizationId, isActive: true },
  });
  if (!client) {
    res.status(403).json({ error: "Client access denied" });
    return;
  }
  res.locals.client = client;
  next();
});

clientWhatsappRouter.get("/:clientId/whatsapp/status", async (req, res) => {
  const status = await clientWhatsApp.getStatus(req.params.clientId);
  res.json({
    connected: status.isConnected,
    phoneNumber: status.phoneNumber,
    lastSync: status.lastSyncAt,
    messagesScanned: status.messagesScanned,
  });
});

clientWhatsappRouter.post("/:clientId/whatsapp/connect", async (req, res) => {
  res.json(await clientWhatsApp.initializeClient(req.params.clientId));
});

clientWhatsappRouter.delete("/:clientId/whatsapp/disconnect", async (req, res) => {
  await clientWhatsApp.disconnect(req.params.clientId);
  res.json({ disconnected: true });
});

clientWhatsappRouter.post("/:clientId/whatsapp/scan", async (req, res) => {
  if (!config.twilio.webEnabled) {
    res.json({
      status: "disabled",
      reason: "WhatsApp Web scanning is disabled. The system only processes new messages received through the Twilio webhook.",
      messagesScanned: 0,
    });
    return;
  }
  const daysBack = Number(req.body?.daysBack ?? 30);
  res.json(await clientWhatsApp.scanHistory(req.params.clientId, Number.isFinite(daysBack) ? daysBack : 30));
});

clientWhatsappRouter.get("/:clientId/whatsapp/messages", async (req, res) => {
  if (!config.twilio.webEnabled) {
    res.json({
      status: "disabled",
      reason: "WhatsApp Web chat reading is disabled.",
      messages: [],
    });
    return;
  }
  const messages = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT "id","from","to","body","timestamp","hasInvoice","hasTask","processed","invoiceId","taskId","createdAt" FROM "WhatsAppMessage" WHERE "clientId" = $1 ORDER BY "timestamp" DESC LIMIT 100',
    req.params.clientId
  );
  res.json({ messages });
});
