import { config, hasTwilio } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardStats } from "./dashboard.js";

type WhatsAppMetadata = { ownerWhatsApp?: string };

async function getTwilioClient() {
  if (!hasTwilio()) return null;
  const twilio = (await import("twilio")).default;
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

export function normalizeWhatsAppNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

function parseMetadata(metadata: string | null): WhatsAppMetadata {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as WhatsAppMetadata;
  } catch {
    return {};
  }
}

export async function getWhatsAppSettings(organizationId: string) {
  const integration = await prisma.integration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "twilio" } },
  });
  const metadata = parseMetadata(integration?.metadata ?? null);
  const ownerWhatsApp = metadata.ownerWhatsApp || config.twilio.ownerWhatsApp;

  return {
    configured: hasTwilio(),
    connected: Boolean(integration && ownerWhatsApp),
    ownerWhatsApp: ownerWhatsApp || "",
    from: config.twilio.whatsappFrom,
    connectedAt: integration?.connectedAt ?? null,
  };
}

export async function saveWhatsAppSettings(organizationId: string, ownerWhatsApp: string) {
  const normalized = normalizeWhatsAppNumber(ownerWhatsApp);
  if (!normalized) throw new Error("WhatsApp number is required");

  return prisma.integration.upsert({
    where: { organizationId_provider: { organizationId, provider: "twilio" } },
    create: {
      organizationId,
      provider: "twilio",
      metadata: JSON.stringify({ ownerWhatsApp: normalized } satisfies WhatsAppMetadata),
    },
    update: {
      metadata: JSON.stringify({ ownerWhatsApp: normalized } satisfies WhatsAppMetadata),
    },
  });
}

export async function findOrganizationByWhatsAppNumber(fromNumber: string) {
  const normalized = normalizeWhatsAppNumber(fromNumber);
  const integrations = await prisma.integration.findMany({
    where: { provider: "twilio" },
    select: { organizationId: true, metadata: true },
  });
  const match = integrations.find((integration) => parseMetadata(integration.metadata).ownerWhatsApp === normalized);
  if (match) return match.organizationId;

  if (config.twilio.ownerWhatsApp && normalizeWhatsAppNumber(config.twilio.ownerWhatsApp) === normalized) {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    return org?.id ?? null;
  }
  return null;
}

export async function findClientByWhatsAppNumber(fromNumber: string) {
  const normalized = normalizeWhatsAppNumber(fromNumber);
  return prisma.client.findFirst({
    where: { whatsappNumber: normalized, isActive: true },
  });
}

export async function sendWhatsAppMessage(organizationId: string, body: string) {
  const client = await getTwilioClient();
  const settings = await getWhatsAppSettings(organizationId);
  if (!client || !settings.ownerWhatsApp) return { sent: false, reason: "Twilio is not configured" };

  const message = await client.messages.create({
    from: config.twilio.whatsappFrom,
    to: settings.ownerWhatsApp,
    body,
  });

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      direction: "outbound",
      body,
      toNumber: settings.ownerWhatsApp,
      fromNumber: config.twilio.whatsappFrom,
    },
  });

  return { sent: true, sid: message.sid };
}

export async function sendClientWhatsAppMessage(clientId: string, body: string, aiGenerated = false) {
  const clientRecord = await prisma.client.findUnique({ where: { id: clientId } });
  if (!clientRecord?.whatsappNumber) return { sent: false, reason: "Client WhatsApp number is missing" };

  const twilioClient = await getTwilioClient();
  if (!twilioClient) return { sent: false, reason: "Twilio is not configured" };

  try {
    const message = await twilioClient.messages.create({
      from: config.twilio.whatsappFrom,
      to: clientRecord.whatsappNumber,
      body,
    });
    await prisma.whatsAppLog.create({
      data: {
        organizationId: clientRecord.organizationId,
        clientId,
        direction: "outbound",
        body,
        fromNumber: config.twilio.whatsappFrom,
        toNumber: clientRecord.whatsappNumber,
        aiGenerated,
        read: true,
      },
    });
    return { sent: true, sid: message.sid };
  } catch (err) {
    console.error("[twilio] send failed", { clientId, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export async function generateWhatsAppReply(body: string) {
  const text = body.trim();
  if (!text) return "תודה על הודעתך, נחזור אליך בקרוב";
  if (/חשבונית|invoice|קבלה|receipt/i.test(text)) {
    return "תודה, קיבלנו את המסמך. נבדוק אותו ונעדכן אם חסר משהו.";
  }
  if (/סטטוס|status/i.test(text)) {
    return "תודה על הפנייה. נבדוק את הסטטוס ונחזור אליך בקרוב.";
  }
  return "תודה על הודעתך, נחזור אליך בקרוב";
}

export async function notifyNewInvoice(
  organizationId: string,
  supplier: string,
  amount: number | null
) {
  const msg = `🧾 חשבונית חדשה\nספק: ${supplier}\nסכום: ₪${amount ?? "לא זוהה"}`;
  await sendWhatsAppMessage(organizationId, msg);
}

export async function handleWhatsAppCommand(
  organizationId: string,
  body: string,
  fromNumber?: string
): Promise<string> {
  const cmd = body.trim().toUpperCase();

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      direction: "inbound",
      body,
      fromNumber: fromNumber ? normalizeWhatsAppNumber(fromNumber) : undefined,
    },
  });

  switch (cmd) {
    case "HELP":
    case "עזרה":
      return `פקודות:\nSTATUS — מצב\nSUMMARY — סיכום\nSYNC — סריקת Gmail\nPAYMENTS — לשלם\nMISSING — חשבוניות חסרות`;
    case "STATUS":
    case "מצב": {
      const s = await getDashboardStats(organizationId);
      return `לשלם: ₪${s.moneyToPay}\nחסרות: ${s.missingInvoicesCount}\nמשימות: ${s.openTasks}`;
    }
    case "SUMMARY":
    case "סיכום": {
      const { buildDailySummary } = await import("./summary.js");
      return buildDailySummary(organizationId);
    }
    case "SYNC":
    case "סנכרון": {
      const { syncGmailForOrganization } = await import("./gmail-sync.js");
      const r = await syncGmailForOrganization(organizationId);
      return `סונכרן: ${r.emailsProcessed} מיילים, ${r.paymentsCreated} תשלומים חדשים`;
    }
    case "PAYMENTS":
    case "תשלומים": {
      const open = await prisma.supplierPayment.findMany({
        where: { organizationId, paid: false, paymentRequired: true },
        take: 10,
        orderBy: { dueDate: "asc" },
      });
      if (!open.length) return "אין תשלומים פתוחים";
      return open
        .map((p) => `• ${p.supplier} ₪${p.amount}${p.dueDate ? ` עד ${p.dueDate.toLocaleDateString("he-IL")}` : ""}`)
        .join("\n");
    }
    case "MISSING":
    case "חסרות": {
      const m = await prisma.supplierPayment.findMany({
        where: { organizationId, missingInvoice: true, paid: false },
        take: 10,
      });
      if (!m.length) return "אין חשבוניות חסרות";
      return m.map((p) => `• ${p.supplier} ₪${p.amount}`).join("\n");
    }
    default:
      return `לא הכרתי את הפקודה. שלח HELP`;
  }
}
