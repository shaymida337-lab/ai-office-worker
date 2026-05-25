import { Router, type Request, type Response } from "express";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { authMiddleware } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardStats, getMissingInvoicesReport } from "../services/dashboard.js";
import { buildDailySummary } from "../services/summary.js";
import {
  getWhatsAppSettings,
  saveWhatsAppSettings,
  sendWhatsAppMessage,
} from "../services/whatsapp.js";

export const apiRouter = Router();
apiRouter.use(authMiddleware);


apiRouter.post("/automation/first-scan", async (req, res) => {
  const { scheduler } = await import("../services/scheduler.js");
  scheduler.runFirstTimeScan(req.auth!.organizationId).catch((err) => {
    console.error("[automation] first-time scan failed", err);
  });
  res.json({ started: true, message: "ברוך הבא! מתחיל סריקה ראשונית..." });
});

apiRouter.get("/automation/scan-status", async (req, res) => {
  const logs = await prisma.$queryRawUnsafe<Array<{ id: string; type: string; status: string; found: number; saved: number; errors: string | null; startedAt: Date; endedAt: Date | null }>>(
    'SELECT "id", "type", "status", "found", "saved", "errors", "startedAt", "endedAt" FROM "ScanLog" WHERE "orgId" = $1 ORDER BY "startedAt" DESC LIMIT 10',
    req.auth!.organizationId
  );
  const last = logs[0] ?? null;
  const nextDaily = new Date();
  nextDaily.setHours(2, 0, 0, 0);
  if (nextDaily <= new Date()) nextDaily.setDate(nextDaily.getDate() + 1);
  res.json({ last, logs, nextScheduledScanAt: nextDaily.toISOString() });
});

apiRouter.get("/dashboard", async (req, res) => {
  const stats = await getDashboardStats(req.auth!.organizationId);
  res.json(stats);
});

apiRouter.post("/help/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question : "";
  const { answerHelpQuestion } = await import("../services/helpAI.js");
  res.json({ answer: await answerHelpQuestion(question) });
});

apiRouter.get("/accountant/settings", async (req, res) => {
  const { getAccountantSettings } = await import("../services/accountantReports.js");
  res.json(await getAccountantSettings(req.auth!.organizationId));
});

apiRouter.put("/accountant/settings", async (req, res) => {
  const { updateAccountantSettings } = await import("../services/accountantReports.js");
  res.json(await updateAccountantSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/accountant/summary", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const { buildAccountantSummary } = await import("../services/accountantReports.js");
  res.json(await buildAccountantSummary(req.auth!.organizationId, period));
});

apiRouter.post("/accountant/generate", async (req, res) => {
  const period = typeof req.body?.period === "string" ? req.body.period : undefined;
  const { generateAccountantReport } = await import("../services/accountantReports.js");
  res.json(await generateAccountantReport(req.auth!.organizationId, period));
});

apiRouter.get("/accountant/download.zip", async (req, res) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const { accountantZipBuffer, buildAccountantSummary } = await import("../services/accountantReports.js");
  const buffer = accountantZipBuffer(await buildAccountantSummary(req.auth!.organizationId, period));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", "attachment; filename=accountant-report.zip");
  res.send(buffer);
});

apiRouter.post("/accountant/send", async (req, res) => {
  const period = typeof req.body?.period === "string" ? req.body.period : undefined;
  const { generateAccountantReport } = await import("../services/accountantReports.js");
  const report = await generateAccountantReport(req.auth!.organizationId, period);
  res.json({ sent: false, reason: "Email provider is not configured yet", report });
});


apiRouter.get("/invoices", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(clientId && { clientId }),
      ...(status && status !== "all" && { status }),
      ...(search && { invoiceNumber: { contains: search, mode: "insensitive" } }),
    },
    include: { client: { select: { id: true, name: true, color: true } } },
    orderBy: { date: "desc" },
    take: 300,
  });
  res.json({ invoices });
});

apiRouter.put("/invoices/:id/status", async (req, res) => {
  const body = req.body as { status?: string };
  if (!body.status || !["paid", "pending", "overdue"].includes(body.status)) {
    res.status(400).json({ error: "Invalid invoice status" });
    return;
  }
  const invoice = await prisma.invoice.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const updated = await prisma.invoice.update({ where: { id: invoice.id }, data: { status: body.status } });
  try {
    const { updateInvoiceStatusInSheets } = await import("../services/clientSheetsService.js");
    await updateInvoiceStatusInSheets(invoice.clientId, invoice.sheetsRow, body.status);
  } catch (err) {
    console.error("[invoices] failed to update sheet status", err);
  }
  res.json({ invoice: updated });
});

apiRouter.get("/organizations/:id/invoices/summary", async (req, res) => {
  if (req.params.id !== req.auth!.organizationId) {
    res.status(403).json({ error: "Organization access denied" });
    return;
  }
  const invoices = await prisma.invoice.findMany({
    where: { organizationId: req.auth!.organizationId },
    include: { client: { select: { id: true, name: true } } },
  });
  const byStatus = invoices.reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.status] = (acc[invoice.status] ?? 0) + invoice.amount;
    return acc;
  }, {});
  const byClient = invoices.reduce<Record<string, { clientId: string; clientName: string; count: number; amount: number }>>((acc, invoice) => {
    const current = acc[invoice.clientId] ?? { clientId: invoice.clientId, clientName: invoice.client.name, count: 0, amount: 0 };
    current.count += 1;
    current.amount += invoice.amount;
    acc[invoice.clientId] = current;
    return acc;
  }, {});
  res.json({ count: invoices.length, byStatus, byClient: Object.values(byClient) });
});

apiRouter.get("/payments", async (req, res) => {
  const payments = await prisma.supplierPayment.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { date: "desc" },
    take: 100,
  });
  res.json(payments);
});

apiRouter.patch("/payments/:id", async (req, res) => {
  const { paid, invoiceLink, documentLink } = req.body as {
    paid?: boolean;
    invoiceLink?: string;
    documentLink?: string;
  };
  const payment = await prisma.supplierPayment.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      ...(paid !== undefined && { paid }),
      ...(invoiceLink !== undefined && { invoiceLink, missingInvoice: false }),
      ...(documentLink !== undefined && { documentLink }),
    },
  });
  res.json({ updated: payment.count });
});

apiRouter.get("/tasks", async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(tasks);
});

apiRouter.patch("/tasks/:id", async (req, res) => {
  const { status } = req.body as { status?: string };
  const updated = await prisma.task.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: { status: status ?? "done" },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.put("/tasks/:id", async (req, res) => {
  const body = req.body as {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    priority?: string;
    status?: string;
  };
  const title = body.title?.trim();
  if (!title) {
    res.status(400).json({ error: "Task title is required" });
    return;
  }
  const dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    res.status(400).json({ error: "Invalid due date" });
    return;
  }
  const updated = await prisma.task.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      title,
      description: body.description?.trim() || null,
      dueDate,
      ...(body.priority && { priority: body.priority }),
      ...(body.status && { status: body.status }),
    },
  });
  if (updated.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.delete("/tasks/:id", async (req, res) => {
  const deleted = await prisma.task.deleteMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (deleted.count === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

apiRouter.get("/reports/missing-invoices", async (req, res) => {
  const report = await getMissingInvoicesReport(req.auth!.organizationId);
  res.json(report);
});

apiRouter.get("/alerts", async (req, res) => {
  const alerts = await prisma.alert.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  res.json(alerts);
});

apiRouter.get("/summary/daily", async (req, res) => {
  const text = await buildDailySummary(req.auth!.organizationId);
  res.json({ text });
});

async function sendWhatsAppStatus(req: Request, res: Response) {
  res.json(await getWhatsAppSettings(req.auth!.organizationId));
}

async function saveWhatsAppNumber(req: Request, res: Response) {
  const body = req.body as { ownerWhatsApp?: string };
  if (!body.ownerWhatsApp?.trim()) {
    res.status(400).json({ error: "WhatsApp number is required" });
    return;
  }

  await saveWhatsAppSettings(req.auth!.organizationId, body.ownerWhatsApp);
  res.json(await getWhatsAppSettings(req.auth!.organizationId));
}

async function sendWhatsAppTest(req: Request, res: Response) {
  const result = await sendWhatsAppMessage(
    req.auth!.organizationId,
    "✅ AI Office Worker WhatsApp מחובר בהצלחה!"
  );
  if (!result.sent) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json(result);
}

apiRouter.get("/integrations/whatsapp/status", sendWhatsAppStatus);
apiRouter.put("/integrations/whatsapp/settings", saveWhatsAppNumber);
apiRouter.get("/whatsapp/status", sendWhatsAppStatus);
apiRouter.post("/settings/whatsapp", saveWhatsAppNumber);
apiRouter.post("/whatsapp/test", sendWhatsAppTest);
apiRouter.post("/integrations/whatsapp/test", sendWhatsAppTest);

apiRouter.get("/whatsapp-assistant/settings", async (req, res) => {
  const { getWhatsAppAssistantSettings } = await import("../services/whatsappAssistant.js");
  res.json(await getWhatsAppAssistantSettings(req.auth!.organizationId));
});

apiRouter.put("/whatsapp-assistant/settings", async (req, res) => {
  const { updateWhatsAppAssistantSettings } = await import("../services/whatsappAssistant.js");
  res.json(await updateWhatsAppAssistantSettings(req.auth!.organizationId, req.body as Record<string, unknown>));
});

apiRouter.get("/whatsapp-assistant/stats", async (req, res) => {
  const { getWhatsAppAssistantStats } = await import("../services/whatsappAssistant.js");
  res.json(await getWhatsAppAssistantStats(req.auth!.organizationId));
});

apiRouter.post("/whatsapp-assistant/test/:type", async (req, res) => {
  const type = req.params.type === "number" ? "number" : "morning";
  const { sendAssistantTest } = await import("../services/whatsappAssistant.js");
  const result = await sendAssistantTest(req.auth!.organizationId, type);
  if (!result.sent) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json(result);
});

async function scanGmail(req: Request, res: Response) {
  try {
    const { syncGmailForOrganization } = await import("../services/gmail-sync.js");
    const result = await syncGmailForOrganization(req.auth!.organizationId);
    res.json({
      ...result,
      emailsFound: result.emailsProcessed,
      success: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    if (message === "Gmail not connected") {
      res.status(409).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
}

apiRouter.post("/sync/gmail", scanGmail);
apiRouter.post("/gmail/scan", scanGmail);

apiRouter.post("/camera/invoices/preview", async (req, res) => {
  try {
    const body = req.body as {
      filename?: string;
      mimeType?: string;
      fileBase64?: string;
    };

    if (!body.fileBase64 || !body.mimeType) {
      res.status(400).json({ error: "Invoice file is required" });
      return;
    }

    if (!["image/jpeg", "image/png", "application/pdf"].includes(body.mimeType)) {
      res.status(400).json({ error: "Only jpg, png and pdf invoices are supported" });
      return;
    }

    const { analyzeInvoiceFile } = await import("../services/claude.js");
    const preview = await analyzeInvoiceFile({
      fileBase64: body.fileBase64,
      mimeType: body.mimeType,
      filename: body.filename,
    });

    res.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invoice preview failed";
    res.status(500).json({ error: message });
  }
});

apiRouter.post("/camera/invoices", async (req, res) => {
  try {
    const body = req.body as {
      supplier?: string;
      amount?: number;
      currency?: string;
      invoiceDate?: string;
      invoiceNumber?: string;
      dueDate?: string;
      filename?: string;
      mimeType?: string;
      fileBase64?: string;
    };

    if (!body.supplier || typeof body.amount !== "number") {
      res.status(400).json({ error: "Supplier and amount are required" });
      return;
    }
    const invoiceDate = body.invoiceDate ? new Date(body.invoiceDate) : new Date();
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    if (Number.isNaN(invoiceDate.getTime()) || (dueDate && Number.isNaN(dueDate.getTime()))) {
      res.status(400).json({ error: "Invalid invoice date" });
      return;
    }

    let documentLink: string | undefined;
    if (body.fileBase64 && body.filename) {
      const uploadDir = path.join(process.cwd(), "uploads", "camera-invoices");
      await mkdir(uploadDir, { recursive: true });
      const safeName = body.filename.replace(/[\\/:*?"<>|]/g, "-");
      const storedName = `${Date.now()}_${safeName}`;
      await writeFile(path.join(uploadDir, storedName), Buffer.from(body.fileBase64, "base64"));
      documentLink = `/uploads/camera-invoices/${storedName}`;
    }

    const payment = await prisma.supplierPayment.create({
      data: {
        organizationId: req.auth!.organizationId,
        supplier: body.supplier,
        amount: body.amount,
        currency: body.currency || "ILS",
        date: invoiceDate,
        dueDate,
        paid: false,
        documentLink,
        invoiceLink: documentLink,
        paymentRequired: true,
        missingInvoice: false,
        source: "camera",
        subject: body.invoiceNumber
          ? `Camera invoice scan #${body.invoiceNumber}`
          : "Camera invoice scan",
      },
    });

    res.json(payment);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Camera scan failed";
    res.status(500).json({ error: message });
  }
});

async function sendBusinessHealth(req: Request, res: Response) {
  const stats = await getDashboardStats(req.auth!.organizationId);
  const score = stats.businessHealthScore;
  const recommendations: string[] = [];

  if (stats.missingInvoicesCount > 0) {
    recommendations.push("לטפל בחשבוניות חסרות מול ספקים.");
  }
  if (stats.overdueCustomerInvoices > 0) {
    recommendations.push("לשלוח תזכורות גבייה ללקוחות באיחור.");
  }
  if (stats.upcomingPaymentsCount > 0) {
    recommendations.push("לבדוק תשלומי ספקים קרובים לשבוע הקרוב.");
  }
  if (recommendations.length === 0) {
    recommendations.push("המצב נראה תקין. המשך לעקוב אחרי תשלומים פתוחים.");
  }

  res.json({
    score,
    status: score >= 80 ? "good" : score >= 60 ? "warning" : "risk",
    recommendations,
    metrics: {
      moneyToPay: stats.moneyToPay,
      moneyToReceive: stats.moneyToReceive,
      missingInvoices: stats.missingInvoicesCount,
      overdueCustomerInvoices: stats.overdueCustomerInvoices,
      overdueSupplierPayments: stats.overdueSupplierPayments,
      hoursSavedThisWeek: stats.hoursSavedThisWeek,
    },
  });
}

apiRouter.get("/business-health", async (req, res) => {
  await sendBusinessHealth(req, res);
});

apiRouter.get("/health-score", async (req, res) => {
  await sendBusinessHealth(req, res);
});

apiRouter.get("/customer-invoices", async (req, res) => {
  const invoices = await prisma.customerInvoice.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { dueDate: "asc" },
  });
  res.json(invoices);
});

apiRouter.post("/customer-invoices", async (req, res) => {
  const body = req.body as {
    customer?: string;
    amount?: number;
    dueDate?: string;
    notes?: string;
  };

  if (!body.customer || typeof body.amount !== "number") {
    res.status(400).json({ error: "Customer and amount are required" });
    return;
  }

  const invoice = await prisma.customerInvoice.create({
    data: {
      organizationId: req.auth!.organizationId,
      customer: body.customer,
      amount: body.amount,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      notes: body.notes,
    },
  });

  res.json(invoice);
});

apiRouter.patch("/customer-invoices/:id", async (req, res) => {
  const body = req.body as { paid?: boolean; reminderSent?: boolean };
  const invoice = await prisma.customerInvoice.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      ...(body.paid !== undefined && { paid: body.paid }),
      ...(body.reminderSent && { reminderSentAt: new Date() }),
    },
  });
  res.json({ updated: invoice.count });
});

apiRouter.post("/customer-invoices/:id/reminder", async (req, res) => {
  const invoice = await prisma.customerInvoice.findFirst({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
  });
  if (!invoice) {
    res.status(404).json({ error: "Customer invoice not found" });
    return;
  }

  await prisma.customerInvoice.update({
    where: { id: invoice.id },
    data: { reminderSentAt: new Date() },
  });

  res.json({
    message: `שלום ${invoice.customer}, מזכירים שקיימת חשבונית פתוחה על סך ₪${invoice.amount}. נשמח להסדרת התשלום בהקדם. תודה.`,
  });
});

apiRouter.get("/social-drafts", async (req, res) => {
  const drafts = await prisma.socialDraft.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(drafts);
});

apiRouter.post("/social-drafts", async (req, res) => {
  const body = req.body as {
    platform?: string;
    topic?: string;
    tone?: string;
  };

  const platform = body.platform || "facebook";
  const topic = body.topic || "טיפ עסקי";
  const tone = body.tone || "מקצועי וידידותי";
  const content = buildSocialDraft(platform, topic, tone);

  const draft = await prisma.socialDraft.create({
    data: {
      organizationId: req.auth!.organizationId,
      platform,
      topic,
      content,
    },
  });

  res.json(draft);
});

apiRouter.patch("/social-drafts/:id", async (req, res) => {
  const body = req.body as { status?: string; content?: string };
  const draft = await prisma.socialDraft.updateMany({
    where: { id: req.params.id, organizationId: req.auth!.organizationId },
    data: {
      ...(body.status && { status: body.status }),
      ...(body.content && { content: body.content }),
    },
  });
  res.json({ updated: draft.count });
});

function buildSocialDraft(platform: string, topic: string, tone: string) {
  const hashtags =
    platform === "instagram"
      ? "\n\n#עסקים #ניהולעסק #טיפיםלעסקים #ישראל"
      : "\n\nמה דעתכם? כתבו לנו בתגובות.";

  return `פוסט ${platform === "instagram" ? "לאינסטגרם" : "לפייסבוק"} בנושא: ${topic}

בטון ${tone}:

ניהול עסק קטן דורש סדר, מעקב ותגובה מהירה. ${topic} הוא אחד הדברים שיכולים לעזור לבעל העסק לחסוך זמן, לצמצם טעויות ולקבל החלטות טובות יותר.

טיפ קצר: התחילו ממעקב פשוט וקבוע, ואז שפרו אותו בהדרגה עם אוטומציה.${hashtags}`;
}
