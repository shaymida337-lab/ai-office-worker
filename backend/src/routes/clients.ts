import { Router, type RequestHandler } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { authMiddleware, verifyToken, type JwtPayload } from "../lib/auth.js";
import { config } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getOAuth2Client, GMAIL_SCOPES } from "../services/google.js";
import { syncGmailForClient } from "../services/clientGmailSync.js";
import { normalizeWhatsAppNumber, sendClientWhatsAppMessage } from "../services/whatsapp.js";

export const clientsRouter = Router();

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
const VALID_PRIORITIES = new Set(["low", "medium", "high"]);
const VALID_STATUSES = new Set(["todo", "in-progress", "done", "open"]);

function parseSheetId(url?: string): string | null {
  return url?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

function parseFolderId(url?: string): string | null {
  return url?.match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] ?? null;
}

function getParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const checkClientOwnership: RequestHandler = async (req, res, next) => {
  const clientId = getParam(req.params.clientId);
  if (!clientId) {
    res.status(400).json({ error: "Invalid client id" });
    return;
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: req.auth!.organizationId, isActive: true },
  });
  if (!client) {
    res.status(403).json({ error: "Client access denied" });
    return;
  }

  res.locals.client = client;
  next();
};

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
    prisma.task.count({ where: { organizationId, clientId, status: { not: "done" } } }),
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

async function calculateClientHealth(organizationId: string, clientId: string) {
  const [client, totalTasks, doneTasks, recentEmails, payments, missingInvoices] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organizationId, isActive: true } }),
    prisma.task.count({ where: { organizationId, clientId } }),
    prisma.task.count({ where: { organizationId, clientId, status: "done" } }),
    prisma.emailMessage.count({
      where: {
        organizationId,
        clientId,
        receivedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.supplierPayment.count({ where: { organizationId, clientId } }),
    prisma.supplierPayment.count({ where: { organizationId, clientId, missingInvoice: true } }),
  ]);

  const gmailActivity = client?.gmailConnected ? Math.min(100, 50 + recentEmails * 10) : 20;
  const driveUsage = client?.driveFolderId || client?.driveFolderUrl ? 100 : 35;
  const sheetsData =
    client?.invoiceSheetId || client?.taskSheetId || client?.invoiceSheetUrl || client?.taskSheetUrl ? 100 : 35;
  const taskCompletionRate = totalTasks === 0 ? 70 : Math.round((doneTasks / totalTasks) * 100);
  const dataPenalty = Math.min(30, Math.max(0, missingInvoices - payments) * 5);
  const score = Math.max(
    0,
    Math.min(100, Math.round((gmailActivity + driveUsage + sheetsData + taskCompletionRate) / 4 - dataPenalty))
  );

  return {
    score,
    status: score >= 71 ? "good" : score >= 41 ? "warning" : "risk",
    breakdown: { gmailActivity, driveUsage, sheetsData, taskCompletionRate },
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
      health: await calculateClientHealth(organizationId, client.id),
      whatsappUnread: await prisma.whatsAppLog.count({
        where: { organizationId, clientId: client.id, direction: "inbound", read: false },
      }),
      whatsappLastMessage: await prisma.whatsAppLog.findFirst({
        where: { organizationId, clientId: client.id },
        orderBy: { createdAt: "desc" },
      }),
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
  const { name, email, color, invoiceSheetUrl, taskSheetUrl, driveFolderUrl, whatsappNumber } = req.body as {
    name?: string;
    email?: string;
    whatsappNumber?: string;
    color?: string;
    invoiceSheetUrl?: string;
    taskSheetUrl?: string;
    driveFolderUrl?: string;
  };

  if (!name?.trim() || !email?.trim()) {
    res.status(400).json({ error: "Name and email are required" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  const count = await prisma.client.count({ where: { organizationId } });
  const client = await prisma.client.create({
    data: {
      organizationId,
      name: name.trim(),
      email: normalizedEmail,
      whatsappNumber: whatsappNumber?.trim() ? normalizeWhatsAppNumber(whatsappNumber) : null,
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

    const code = req.query.code as string | undefined;
    if (!code) {
      res.redirect(`${config.frontendUrl}/dashboard/clients?error=missing_code`);
      return;
    }

    const decoded = jwt.verify(String(req.query.state), config.jwtSecret) as {
      purpose?: string;
      clientId?: string;
      organizationId?: string;
    };
    if (decoded.purpose !== "client_gmail" || !decoded.clientId || !decoded.organizationId) {
      res.redirect(`${config.frontendUrl}/dashboard/clients?error=invalid_state`);
      return;
    }

    const client = await prisma.client.findFirst({
      where: { id: decoded.clientId, organizationId: decoded.organizationId, isActive: true },
    });
    if (!client) {
      res.redirect(`${config.frontendUrl}/dashboard/clients?error=client_not_found`);
      return;
    }

    const oauth2 = await getOAuth2Client(config.google.clientGmailRedirectUri);
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);
    const oauth2api = await import("googleapis").then((g) =>
      g.google.oauth2({ version: "v2", auth: oauth2 })
    );
    const me = await oauth2api.userinfo.get();
    const connectedEmail = me.data.email?.trim().toLowerCase();
    if (connectedEmail && connectedEmail !== client.email.trim().toLowerCase()) {
      res.redirect(`${config.frontendUrl}/dashboard/clients/${client.id}?error=gmail_account_mismatch`);
      return;
    }

    const refreshToken = tokens.refresh_token ?? client.googleRefreshToken;
    if (!refreshToken) {
      res.redirect(`${config.frontendUrl}/dashboard/clients/${client.id}?error=missing_refresh_token`);
      return;
    }

    await prisma.client.update({
      where: { id: client.id },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: refreshToken,
        gmailConnected: true,
      },
    });

    res.redirect(`${config.frontendUrl}/dashboard/clients/${client.id}?connected=1`);
  } catch {
    res.redirect(`${config.frontendUrl}/dashboard/clients?error=oauth_failed`);
  }
});

clientsRouter.post("/scan-all", authMiddleware, async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { organizationId: req.auth!.organizationId, isActive: true, gmailConnected: true },
  });

  const results = await Promise.allSettled(clients.map((client) => syncGmailForClient(client.id)));
  res.json({
    success: results.every((result) => result.status === "fulfilled"),
    count: clients.length,
    results: results.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : { clientId: clients[index]?.id, error: result.reason instanceof Error ? result.reason.message : "Gmail sync failed" }
    ),
  });
});

clientsRouter.get("/:clientId/connect-gmail", async (req, res) => {
  const auth = authFromQuery(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const clientId = getParam(req.params.clientId);
  if (!clientId) {
    res.status(400).json({ error: "Invalid client id" });
    return;
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: auth.organizationId, isActive: true },
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const oauth2 = await getOAuth2Client(config.google.clientGmailRedirectUri);
  const state = jwt.sign(
    { purpose: "client_gmail", clientId: client.id, organizationId: auth.organizationId, nonce: crypto.randomBytes(16).toString("hex") },
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

clientsRouter.get("/:clientId/tasks", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const tasks = await prisma.task.findMany({
    where: { organizationId: req.auth!.organizationId, clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ tasks });
});

clientsRouter.post("/:clientId/tasks", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const body = req.body as {
    title?: string;
    description?: string;
    dueDate?: string | null;
    priority?: string;
    status?: string;
  };
  const title = body.title?.trim();
  if (!title) {
    res.status(400).json({ error: "Task title is required" });
    return;
  }
  const priority = VALID_PRIORITIES.has(body.priority ?? "") ? body.priority! : "medium";
  const status = VALID_STATUSES.has(body.status ?? "") ? body.status! : "todo";
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    res.status(400).json({ error: "Invalid due date" });
    return;
  }

  const task = await prisma.task.create({
    data: {
      organizationId: req.auth!.organizationId,
      clientId: client.id,
      title,
      description: body.description?.trim() || null,
      dueDate,
      priority,
      status,
      source: "manual",
    },
  });
  res.status(201).json({ task });
});

clientsRouter.get("/:clientId/whatsapp", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const messages = await prisma.whatsAppLog.findMany({
    where: { organizationId: req.auth!.organizationId, clientId: client.id },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  await prisma.whatsAppLog.updateMany({
    where: { organizationId: req.auth!.organizationId, clientId: client.id, direction: "inbound", read: false },
    data: { read: true },
  });
  res.json({ messages });
});

clientsRouter.post("/:clientId/whatsapp/send", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const body = req.body as { body?: string };
  const text = body.body?.trim();
  if (!text) {
    res.status(400).json({ error: "Message body is required" });
    return;
  }
  try {
    const result = await sendClientWhatsAppMessage(client.id, text);
    if (!result.sent) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send WhatsApp message" });
  }
});

clientsRouter.get("/:clientId/health-score", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  res.json(await calculateClientHealth(req.auth!.organizationId, client.id));
});

clientsRouter.post("/:clientId/health-score/recalculate", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  res.json(await calculateClientHealth(req.auth!.organizationId, client.id));
});

clientsRouter.post("/:clientId/ai-suggestions", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const [stats, recentTasks, missingInvoices] = await Promise.all([
    clientStats(req.auth!.organizationId, client.id),
    prisma.task.findMany({
      where: { organizationId: req.auth!.organizationId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId: req.auth!.organizationId, clientId: client.id, missingInvoice: true },
      orderBy: { date: "desc" },
      take: 3,
    }),
  ]);

  const suggestions = [
    ...(missingInvoices.length > 0
      ? missingInvoices.map((payment) => ({
          title: `לבקש חשבונית מ${payment.supplier}`,
          description: `נמצאה דרישת תשלום ללא חשבונית עבור ${payment.supplier}.`,
          priority: "high",
        }))
      : []),
    ...(stats.openTasks > 3
      ? [
          {
            title: "לסגור משימות פתוחות",
            description: `יש ${stats.openTasks} משימות פתוחות ללקוח. כדאי לתעדף ולסגור ישנות.`,
            priority: "medium",
          },
        ]
      : []),
    ...(stats.toPay > 0
      ? [
          {
            title: "לעבור על תשלומים פתוחים",
            description: `קיימים תשלומים פתוחים בסך ₪${Math.round(stats.toPay).toLocaleString("he-IL")}.`,
            priority: "medium",
          },
        ]
      : []),
    ...(recentTasks.length === 0
      ? [
          {
            title: "לבצע בדיקת סטטוס ללקוח",
            description: "אין משימות אחרונות. מומלץ לבדוק אם יש פעולות פתוחות מול הלקוח.",
            priority: "low",
          },
        ]
      : []),
  ].slice(0, 5);

  res.json({ suggestions });
});

clientsRouter.get("/:clientId", authMiddleware, checkClientOwnership, async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const client = res.locals.client;

  const [payments, tasks, stats, health] = await Promise.all([
    prisma.supplierPayment.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { date: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: { organizationId, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    clientStats(organizationId, client.id),
    calculateClientHealth(organizationId, client.id),
  ]);

  res.json({
    client: { ...client, googleAccessToken: undefined, googleRefreshToken: undefined, stats, health },
    payments,
    tasks,
  });
});

clientsRouter.put("/:clientId", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const body = req.body as Record<string, string | undefined>;
  if (body.email !== undefined && !isValidEmail(body.email.trim().toLowerCase())) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  const updated = await prisma.client.update({
    where: { id: client.id },
    data: {
      ...(body.name && { name: body.name.trim() }),
      ...(body.email && { email: body.email.trim().toLowerCase() }),
      ...(body.whatsappNumber !== undefined && {
        whatsappNumber: body.whatsappNumber?.trim() ? normalizeWhatsAppNumber(body.whatsappNumber) : null,
      }),
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

clientsRouter.post("/:clientId/scan", authMiddleware, checkClientOwnership, async (_req, res) => {
  const client = res.locals.client;
  if (!client.gmailConnected || !client.googleRefreshToken) {
    res.status(400).json({ error: "חבר Gmail בהגדרות" });
    return;
  }

  const result = await syncGmailForClient(client.id);
  res.json({ success: true, result });
});
