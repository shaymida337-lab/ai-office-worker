import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { authMiddleware, verifyToken, type JwtPayload } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getOAuth2Client, GMAIL_SCOPES } from "../services/google.js";
import { syncGmailForClient } from "../services/clientGmailSync.js";

export const clientsRouter = Router();

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

function parseSheetId(url?: string): string | null {
  return url?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

function parseFolderId(url?: string): string | null {
  return url?.match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

function authFromQuery(req: { query: Record<string, unknown>; headers: { authorization?: string } }): JwtPayload | null {
  const token =
    (typeof req.query.token === "string" ? req.query.token : null) ||
    (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

async function clientStats(organizationId: string, clientId: string) {
  const [invoices, openTasks, toPay, missingInvoices] = await Promise.all([
    prisma.supplierPayment.count({ where: { organizationId, clientId } }),
    prisma.task.count({ where: { organizationId, clientId, status: "open" } }),
    prisma.supplierPayment.aggregate({
      where: { organizationId, clientId, paid: false },
      _sum: { amount: true },
    }),
    prisma.supplierPayment.count({ where: { organizationId, clientId, missingInvoice: true } }),
  ]);

  return {
    invoices,
    openTasks,
    toPay: toPay._sum.amount ?? 0,
    missingInvoices,
  };
}

clientsRouter.get("/", authMiddleware, async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const clients = await prisma.client.findMany({
    where: { organizationId, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const clientsWithStats = await Promise.all(
    clients.map(async (client) => ({
      ...client,
      googleAccessToken: undefined,
      googleRefreshToken: undefined,
      stats: await clientStats(organizationId, client.id),
    }))
  );

  const totals = clientsWithStats.reduce(
    (acc, client) => ({
      toPay: acc.toPay + client.stats.toPay,
      openTasks: acc.openTasks + client.stats.openTasks,
      invoices: acc.invoices + client.stats.invoices,
      missingInvoices: acc.missingInvoices + client.stats.missingInvoices,
    }),
    { toPay: 0, openTasks: 0, invoices: 0, missingInvoices: 0 }
  );

  res.json({ clients: clientsWithStats, totals });
});

clientsRouter.post("/", authMiddleware, async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const { name, email, color, invoiceSheetUrl, taskSheetUrl, driveFolderUrl } = req.body as {
    name?: string;
    email?: string;
    color?: string;
    invoiceSheetUrl?: string;
    taskSheetUrl?: string;
    driveFolderUrl?: string;
  };

  if (!name?.trim() || !email?.trim()) {
    res.status(400).json({ error: "Name and email are required" });
    return;
  }

  const count = await prisma.client.count({ where: { organizationId } });
  const client = await prisma.client.create({
    data: {
      organizationId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      color: color || COLORS[count % COLORS.length],
      invoiceSheetUrl: invoiceSheetUrl?.trim() || null,
      invoiceSheetId: parseSheetId(invoiceSheetUrl),
      taskSheetUrl: taskSheetUrl?.trim() || null,
      taskSheetId: parseSheetId(taskSheetUrl),
      driveFolderUrl: driveFolderUrl?.trim() || null,
      driveFolderId: parseFolderId(driveFolderUrl),
    },
  });

  res.status(201).json({ client: { ...client, stats: await clientStats(organizationId, client.id) } });
});

clientsRouter.get("/gmail/callback", async (req, res) => {
  try {
    if (req.query.error) {
      res.redirect(`${config.frontendUrl}/dashboard/clients?error=oauth_denied`);
      return;
    }

    const decoded = jwt.verify(String(req.query.state), config.jwtSecret) as { purpose: string; clientId: string };
    if (decoded.purpose !== "client_gmail") {
      res.redirect(`${config.frontendUrl}/dashboard/clients?error=invalid_state`);
      return;
    }

    const oauth2 = await getOAuth2Client(config.google.clientGmailRedirectUri);
    const { tokens } = await oauth2.getToken(String(req.query.code));
    await prisma.client.update({
      where: { id: decoded.clientId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token ?? undefined,
        gmailConnected: true,
      },
    });

    res.redirect(`${config.frontendUrl}/dashboard/clients/${decoded.clientId}?connected=1`);
  } catch {
    res.redirect(`${config.frontendUrl}/dashboard/clients?error=oauth_failed`);
  }
});

clientsRouter.post("/scan-all", authMiddleware, async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { organizationId: req.auth!.organizationId, isActive: true, gmailConnected: true },
  });

  const results = await Promise.all(clients.map((client) => syncGmailForClient(client.id)));
  res.json({ success: true, count: clients.length, results });
});

clientsRouter.get("/:clientId/connect-gmail", async (req, res) => {
  const auth = authFromQuery(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, organizationId: auth.organizationId, isActive: true },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const oauth2 = await getOAuth2Client(config.google.clientGmailRedirectUri);
  const state = jwt.sign(
    { purpose: "client_gmail", clientId: client.id, nonce: crypto.randomBytes(16).toString("hex") },
    config.jwtSecret,
    { expiresIn: "15m" }
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
    login_hint: client.email,
  });
  res.redirect(url);
});

clientsRouter.get("/:clientId", authMiddleware, async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, organizationId, isActive: true },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const [payments, tasks, stats] = await Promise.all([
    prisma.supplierPayment.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { date: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: { organizationId, clientId: client.id, status: "open" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    clientStats(organizationId, client.id),
  ]);

  res.json({
    client: { ...client, googleAccessToken: undefined, googleRefreshToken: undefined, stats },
    payments,
    tasks,
  });
});

clientsRouter.put("/:clientId", authMiddleware, async (req, res) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, organizationId: req.auth!.organizationId },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const body = req.body as Record<string, string | undefined>;
  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      ...(body.name && { name: body.name.trim() }),
      ...(body.email && { email: body.email.trim().toLowerCase() }),
      ...(body.color && { color: body.color }),
      ...(body.invoiceSheetUrl !== undefined && {
        invoiceSheetUrl: body.invoiceSheetUrl?.trim() || null,
        invoiceSheetId: parseSheetId(body.invoiceSheetUrl),
      }),
      ...(body.taskSheetUrl !== undefined && {
        taskSheetUrl: body.taskSheetUrl?.trim() || null,
        taskSheetId: parseSheetId(body.taskSheetUrl),
      }),
      ...(body.driveFolderUrl !== undefined && {
        driveFolderUrl: body.driveFolderUrl?.trim() || null,
        driveFolderId: parseFolderId(body.driveFolderUrl),
      }),
    },
  });

  res.json({ client: { ...updated, stats: await clientStats(req.auth!.organizationId, updated.id) } });
});

clientsRouter.post("/:clientId/scan", authMiddleware, async (req, res) => {
  const client = await prisma.client.findFirst({
    where: { id: req.params.clientId, organizationId: req.auth!.organizationId, gmailConnected: true },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found or Gmail not connected" });
    return;
  }

  const result = await syncGmailForClient(client.id);
  res.json({ success: true, result });
});
