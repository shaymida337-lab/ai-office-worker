import Anthropic from "@anthropic-ai/sdk";
import { config, hasClaude } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardStats } from "./dashboard.js";
import { buildNatalieDailySummaryMessage } from "./whatsapp/natalieWhatsAppData.js";
import { NATALIE_BRAND, sanitizeWhatsAppText } from "./whatsapp/natalieWhatsAppUx.js";
import { normalizeWhatsAppNumber } from "./whatsapp.js";

const anthropic = hasClaude() ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

type ConversationMessage = { role: "user" | "assistant"; body: string; at: string };
type Handler = (organizationId: string) => Promise<string>;

const OWNER_COMMANDS: Record<string, Handler> = {
  "עזרה": async () => "פקודות: דוח, לקוחות, משימות, התראות, הכנסות",
  "דוח": ownerReport,
  "לקוחות": ownerClients,
  "משימות": ownerTasks,
  "התראות": ownerAlerts,
  "הכנסות": ownerIncome,
};

export async function handleOwnerMessage(message: string, organizationId: string, phone?: string) {
  const text = message.toLowerCase().trim();
  for (const [command, handler] of Object.entries(OWNER_COMMANDS)) {
    if (text.includes(command)) {
      return saveAndReturn(organizationId, phone, undefined, message, await handler(organizationId));
    }
  }

  const context = await buildOwnerContext(organizationId);
  const response = await callClaude(
    [
      `את ${NATALIE_BRAND}, עוזרת אישית לבעל העסק.`,
      "עני בגוף ראשון, בעברית טבעית, קצר וידידותי. מקסימום 5 שורות.",
      "לעולם אל תזכירי AI Office Worker או מונחים טכניים.",
      `מידע על העסק: ${JSON.stringify(context)}`,
      `שאלת הבעלים: ${message}`,
    ].join("\n"),
    "אפשר לשאול אותי על דוח, לקוחות, משימות, התראות או הכנסות."
  );
  return saveAndReturn(organizationId, phone, undefined, message, response);
}

export async function handleClientMessage(message: string, clientId: string, organizationId: string, phone?: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
    select: { id: true },
  });
  if (!client) {
    return sanitizeWhatsAppText("לא מצאתי את הלקוח הזה במערכת.");
  }

  const text = message.toLowerCase().trim();
  let response: string;

  if (text.includes("חשבונית") || text.includes("תשלום")) {
    response = await clientInvoiceStatus(clientId, organizationId);
  } else if (text.includes("משימה") || text.includes("לעשות")) {
    response = await clientTasks(clientId, organizationId);
  } else if (text.includes("מה יש לי") || text.includes("סטטוס")) {
    response = await clientSummary(clientId, organizationId);
  } else {
    const context = await buildClientContext(clientId, organizationId);
    response = await callClaude(
      [
        "אתה עוזר עסקי מקצועי.",
        "ענה בעברית, ידידותי ומקצועי. מקסימום 4 שורות.",
        `מידע על הלקוח: ${JSON.stringify(context)}`,
        `שאלת הלקוח: ${message}`,
      ].join("\n"),
      "אפשר לשאול אותי על חשבוניות, תשלומים, משימות או סטטוס."
    );
  }

  return saveAndReturn(organizationId, phone, clientId, message, response);
}

async function ownerReport(organizationId: string) {
  return buildNatalieDailySummaryMessage(organizationId);
}

async function ownerClients(organizationId: string) {
  const clients = await prisma.client.findMany({ where: { organizationId, isActive: true }, take: 8, orderBy: { createdAt: "desc" } });
  return clients.length ? clients.map((client) => `• ${client.name}`).join("\n") : "אין לקוחות פעילים כרגע.";
}

async function ownerTasks(organizationId: string) {
  const tasks = await prisma.task.findMany({ where: { organizationId, status: "open" }, take: 8, orderBy: { createdAt: "desc" } });
  return tasks.length ? tasks.map((task) => `• ${task.title}`).join("\n") : "אין משימות פתוחות כרגע.";
}

async function ownerAlerts(organizationId: string) {
  const alerts = await prisma.alert.findMany({ where: { organizationId, read: false }, take: 8, orderBy: { createdAt: "desc" } });
  return alerts.length ? alerts.map((alert) => `• ${sanitizeWhatsAppText(alert.title ?? "")}`).join("\n") : "אין התראות פתוחות.";
}

async function ownerIncome(organizationId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const sum = await prisma.invoice.aggregate({ where: { organizationId, date: { gte: monthStart } }, _sum: { amount: true } });
  return `הכנסות החודש: ₪${(sum._sum.amount ?? 0).toLocaleString("he-IL")}`;
}

async function clientInvoiceStatus(clientId: string, organizationId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { clientId, organizationId, status: { not: "paid" } },
    take: 5,
    orderBy: { dueDate: "asc" },
  });
  return invoices.length
    ? invoices.map((invoice) => `• ${invoice.invoiceNumber ?? "חשבונית"} ₪${invoice.amount.toLocaleString("he-IL")} (${invoice.status})`).join("\n")
    : "אין חשבוניות פתוחות כרגע.";
}

async function clientTasks(clientId: string, organizationId: string) {
  const tasks = await prisma.task.findMany({
    where: { clientId, organizationId, status: "open" },
    take: 5,
    orderBy: { createdAt: "desc" },
  });
  return tasks.length ? tasks.map((task) => `• ${task.title}`).join("\n") : "אין משימות פתוחות כרגע.";
}

async function clientSummary(clientId: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { name: true } });
  const [tasks, invoices] = await Promise.all([
    prisma.task.count({ where: { clientId, organizationId, status: "open" } }),
    prisma.invoice.aggregate({
      where: { clientId, organizationId, status: { not: "paid" } },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  return `סטטוס ${client?.name ?? "לקוח"}:\nמשימות פתוחות: ${tasks}\nחשבוניות פתוחות: ${invoices._count}\nסכום פתוח: ₪${(invoices._sum.amount ?? 0).toLocaleString("he-IL")}`;
}

async function buildOwnerContext(organizationId: string) {
  const [stats, activeClients, unreadAlerts] = await Promise.all([
    getDashboardStats(organizationId),
    prisma.client.count({ where: { organizationId, isActive: true } }),
    prisma.alert.count({ where: { organizationId, read: false } }),
  ]);
  return { ...stats, activeClients, unreadAlerts };
}

async function buildClientContext(clientId: string, organizationId: string) {
  const [client, openTasks, openInvoices] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { name: true, email: true } }),
    prisma.task.count({ where: { clientId, organizationId, status: "open" } }),
    prisma.invoice.aggregate({
      where: { clientId, organizationId, status: { not: "paid" } },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  return { client, openTasks, openInvoices: openInvoices._count, openAmount: openInvoices._sum.amount ?? 0 };
}

async function callClaude(prompt: string, fallback: string) {
  if (!anthropic) return fallback;
  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 350,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text.trim() : fallback;
  } catch (err) {
    console.error("[whatsapp-chat] Claude failed", err);
    return fallback;
  }
}

async function saveAndReturn(organizationId: string, phone: string | undefined, clientId: string | undefined, userMessage: string, response: string) {
  if (phone) await appendConversation(organizationId, phone, clientId, userMessage, response);
  return response;
}

async function appendConversation(organizationId: string, rawPhone: string, clientId: string | undefined, userMessage: string, assistantMessage: string) {
  const phone = normalizeWhatsAppNumber(rawPhone);
  const rows = await prisma.$queryRawUnsafe<Array<{ messages: unknown }>>(
    'SELECT "messages" FROM "WhatsAppConversation" WHERE "organizationId" = $1 AND "phone" = $2 LIMIT 1',
    organizationId,
    phone
  );
  const current = Array.isArray(rows[0]?.messages) ? (rows[0].messages as ConversationMessage[]) : [];
  const messages = [
    ...current.slice(-18),
    { role: "user", body: userMessage, at: new Date().toISOString() },
    { role: "assistant", body: assistantMessage, at: new Date().toISOString() },
  ];
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WhatsAppConversation" ("id","organizationId","phone","clientId","messages","lastMessageAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId","phone") DO UPDATE SET "clientId" = EXCLUDED."clientId", "messages" = EXCLUDED."messages", "lastMessageAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP`,
    `wac_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    organizationId,
    phone,
    clientId ?? null,
    JSON.stringify(messages)
  );
}
