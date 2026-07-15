import { Router, type RequestHandler } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import multer from "multer";
import { authMiddleware, verifyToken, type JwtPayload } from "../lib/auth.js";
import { config, hasGoogleOAuth } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getOAuth2Client, GMAIL_SCOPES } from "../services/google.js";
import { syncGmailForClient } from "../services/clientGmailSync.js";
import { scanForInvoices } from "../services/invoiceScanner.js";
import { normalizeWhatsAppNumber, sendClientWhatsAppMessage } from "../services/whatsapp.js";
import { stripClientGoogleTokens } from "../lib/integrationSecrets.js";
import {
  findClientByRealEmail,
  getClientDeliverableEmail,
  normalizeClientEmailInput,
} from "../services/clientContact.js";
import { executeClientImport, previewClientImport } from "../services/clients/clientImport.js";

export const clientsRouter = Router();

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];
const VALID_PRIORITIES = new Set(["low", "medium", "high"]);
const VALID_STATUSES = new Set(["todo", "in-progress", "done", "open"]);
const clientImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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

async function redirectToClientGmailOAuth(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  if (!hasGoogleOAuth()) {
    res.status(503).send("Google OAuth is not configured");
    return;
  }

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
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
    login_hint: getClientDeliverableEmail(client) ?? undefined,
  });
  res.redirect(url);
}

async function clientStats(organizationId: string, clientId: string) {
  const [invoices, openTasks, toPay, missingInvoices] = await Promise.all([
    prisma.invoice.count({ where: { organizationId, clientId } }),
    prisma.task.count({ where: { organizationId, clientId, status: { notIn: ["done", "completed"] } } }),
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
    prisma.task.count({ where: { organizationId, clientId, status: { in: ["done", "completed"] } } }),
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
  const emptyTotals = { toPay: 0, openTasks: 0, invoices: 0, missingInvoices: 0 };
  try {
    const query = prisma.client.findMany({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        organizationId: true,
        name: true,
        email: true,
        domain: true,
        firstSeen: true,
        lastSeen: true,
        whatsappNumber: true,
        phone: true,
        gmailConnected: true,
        invoiceSheetId: true,
        invoiceSheetUrl: true,
        taskSheetId: true,
        taskSheetUrl: true,
        driveFolderId: true,
        driveFolderUrl: true,
        color: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("clients query timed out after 1900ms")), 1900)
    );
    const clients = await Promise.race([query, timeout]);

    const whatsappSummary = clients.length
      ? await prisma.whatsAppLog.groupBy({
          by: ["clientId"],
          where: {
            organizationId,
            clientId: { in: clients.map((client) => client.id) },
            direction: "inbound",
            read: false,
          },
          _count: { _all: true },
        })
      : [];
    const lastWhatsAppMessages = clients.length
      ? await prisma.whatsAppLog.findMany({
          where: {
            organizationId,
            clientId: { in: clients.map((client) => client.id) },
          },
          orderBy: { createdAt: "desc" },
          take: clients.length * 3,
          select: { clientId: true, body: true, createdAt: true, direction: true },
        })
      : [];
    const unreadByClient = new Map(whatsappSummary.map((item) => [item.clientId, item._count._all]));
    const lastByClient = new Map<string, { body: string; createdAt: Date; direction: string }>();
    for (const message of lastWhatsAppMessages) {
      if (message.clientId && !lastByClient.has(message.clientId)) {
        lastByClient.set(message.clientId, message);
      }
    }

    res.json({
      clients: clients.map((client) => ({
        ...client,
        whatsappUnread: unreadByClient.get(client.id) ?? 0,
        whatsappLastMessage: lastByClient.get(client.id) ?? null,
      })),
      totals: emptyTotals,
    });
  } catch (err) {
    console.error(`[clients] list failed org=${organizationId}; returning empty 200 response`, err);
    res.json({ clients: [], totals: emptyTotals, warning: "clients_list_failed" });
  }
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

  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const normalizedEmail = email?.trim() ? normalizeClientEmailInput(email) : null;
  if (email?.trim() && !normalizedEmail) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  if (normalizedEmail && !isValidEmail(normalizedEmail)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  const count = await prisma.client.count({ where: { organizationId } });
  const client = await prisma.client.create({
    data: {
      organizationId,
      name: name.trim(),
      email: normalizedEmail,
      emailIsPlaceholder: false,
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

clientsRouter.post(
  "/import/preview",
  authMiddleware,
  clientImportUpload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file?.buffer?.length) {
        res.status(400).json({ error: "יש להעלות קובץ Excel או CSV" });
        return;
      }
      const lower = (file.originalname || "").toLowerCase();
      if (!/\.(xlsx|xls|csv)$/.test(lower)) {
        res.status(400).json({ error: "נתמכים רק קבצי Excel או CSV" });
        return;
      }
      const preview = await previewClientImport({
        organizationId: req.auth!.organizationId,
        buffer: file.buffer,
        fileName: file.originalname || "clients.xlsx",
      });
      res.json(preview);
    } catch (err) {
      console.error("[clients/import/preview] failed", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "תצוגה מקדימה לייבוא נכשלה" });
    }
  }
);

clientsRouter.post("/import", authMiddleware, async (req, res) => {
  try {
    const body = req.body as { rows?: Array<{
      name?: string;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      notes?: string | null;
    }> };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      res.status(400).json({ error: "אין שורות לייבוא" });
      return;
    }
    const result = await executeClientImport({
      organizationId: req.auth!.organizationId,
      rows: body.rows.map((row) => ({
        name: String(row.name ?? ""),
        phone: row.phone ?? null,
        email: row.email ?? null,
        address: row.address ?? null,
        notes: row.notes ?? null,
      })),
    });
    res.json(result);
  } catch (err) {
    console.error("[clients/import] failed", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "ייבוא לקוחות נכשל" });
  }
});

clientsRouter.get("/connect-gmail/:clientId", redirectToClientGmailOAuth);

clientsRouter.get("/:clientId/connect-gmail-url", authMiddleware, checkClientOwnership, async (req, res) => {
  if (!hasGoogleOAuth()) {
    res.status(503).json({ error: "Google OAuth is not configured" });
    return;
  }

  const client = res.locals.client;
  const oauth2 = await getOAuth2Client(config.google.clientGmailRedirectUri);
  const state = jwt.sign(
    { purpose: "client_gmail", clientId: client.id, organizationId: req.auth!.organizationId, nonce: crypto.randomBytes(16).toString("hex") },
    config.jwtSecret,
    { expiresIn: "15m" }
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state,
    login_hint: getClientDeliverableEmail(client) ?? undefined,
  });
  res.json({ url });
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
    const clientEmail = getClientDeliverableEmail(client);
    if (connectedEmail && clientEmail && connectedEmail !== clientEmail) {
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
  await redirectToClientGmailOAuth(req, res);
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
    const result = await sendClientWhatsAppMessage(client.organizationId, client.id, text);
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


clientsRouter.post("/:clientId/scan/invoices", authMiddleware, checkClientOwnership, async (_req, res) => {
  const client = res.locals.client;
  if (!client.gmailConnected || !client.googleRefreshToken) {
    res.status(400).json({ error: "חבר Gmail בהגדרות" });
    return;
  }
  const result = await scanForInvoices(client.id);
  res.json(result);
});

clientsRouter.get("/:clientId/invoices", authMiddleware, checkClientOwnership, async (req, res) => {
  const client = res.locals.client;
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.auth!.organizationId, clientId: client.id },
    orderBy: { date: "desc" },
    take: 200,
  });
  res.json({ invoices });
});

// ===== כרטיס לקוח — בסיס: תור הבא והערות (clientId + organizationId תמיד) =====

clientsRouter.get("/:clientId/next-appointment", authMiddleware, checkClientOwnership, async (req, res) => {
  try {
    const { findNextAppointmentForClient } = await import("../services/clients/clientCard.js");
    const appointment = await findNextAppointmentForClient({
      organizationId: req.auth!.organizationId,
      clientId: res.locals.client.id,
    });
    res.json({ appointment });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load next appointment" });
  }
});

clientsRouter.get("/:clientId/appointments", authMiddleware, checkClientOwnership, async (req, res) => {
  try {
    const { listClientAppointments } = await import("../services/clients/clientCard.js");
    const appointments = await listClientAppointments({
      organizationId: req.auth!.organizationId,
      clientId: res.locals.client.id,
    });
    res.json({ appointments });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load appointments" });
  }
});

clientsRouter.get("/:clientId/notes", authMiddleware, checkClientOwnership, async (req, res) => {
  try {
    const { listClientNotes } = await import("../services/clients/clientCard.js");
    const notes = await listClientNotes({
      organizationId: req.auth!.organizationId,
      clientId: res.locals.client.id,
    });
    res.json({ notes });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load notes" });
  }
});

clientsRouter.post("/:clientId/notes", authMiddleware, checkClientOwnership, async (req, res) => {
  try {
    const { addClientNote } = await import("../services/clients/clientCard.js");
    const result = await addClientNote({
      organizationId: req.auth!.organizationId,
      clientId: res.locals.client.id,
      body: (req.body as { body?: unknown })?.body,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json({ note: result.note });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to add note" });
  }
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
  try {
    const { updateClientProfile } = await import("../services/clients/clientCard.js");
    const body = req.body as Record<string, string | undefined>;
    const result = await updateClientProfile({
      organizationId: req.auth!.organizationId,
      clientId: res.locals.client.id,
      patch: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.whatsappNumber !== undefined ? { whatsappNumber: body.whatsappNumber } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.invoiceSheetUrl !== undefined ? { invoiceSheetUrl: body.invoiceSheetUrl } : {}),
        ...(body.taskSheetUrl !== undefined ? { taskSheetUrl: body.taskSheetUrl } : {}),
        ...(body.driveFolderUrl !== undefined ? { driveFolderUrl: body.driveFolderUrl } : {}),
      },
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      client: {
        ...stripClientGoogleTokens(result.client),
        stats: await clientStats(req.auth!.organizationId, result.client.id),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update client" });
  }
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
