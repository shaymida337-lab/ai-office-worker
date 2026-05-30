import { config, hasTwilio } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardStats } from "./dashboard.js";

type WhatsAppMetadata = { ownerWhatsApp?: string };
type TwilioMessageClient = {
  messages: {
    create(args: { from: string | undefined; to: string; body: string }): Promise<{ sid: string }>;
  };
};

const TWILIO_SEND_RETRIES = 2;

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTwilioMessageWithRetry(
  client: TwilioMessageClient,
  args: { from: string | undefined; to: string; body: string },
  context: Record<string, string | number | boolean | null | undefined>
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= TWILIO_SEND_RETRIES + 1; attempt += 1) {
    try {
      return await client.messages.create(args);
    } catch (err) {
      lastError = err;
      console.error("[twilio] send attempt failed", {
        ...context,
        attempt,
        maxAttempts: TWILIO_SEND_RETRIES + 1,
        error: errorMessage(err),
      });

      if (attempt <= TWILIO_SEND_RETRIES) {
        await wait(500 * attempt);
      }
    }
  }

  throw lastError;
}

async function getTwilioClient() {
  if (!hasTwilio()) return null;
  const twilio = (await import("twilio")).default;
  return twilio(config.twilio.accountSid, config.twilio.authToken);
}

async function checkTwilioConnection() {
  const client = await getTwilioClient();
  if (!client) return false;
  try {
    await client.api.accounts(config.twilio.accountSid).fetch();
    return true;
  } catch (err) {
    console.error("[twilio] connection check failed", err instanceof Error ? err.message : String(err));
    return false;
  }
}

export function normalizeWhatsAppNumber(value: string) {
  const trimmed = value.trim().replace(/^whatsapp:/i, "");
  if (!trimmed) return "";
  let number = trimmed.replace(/[\s().-]/g, "");
  if (number.startsWith("00")) number = `+${number.slice(2)}`;
  if (number.startsWith("0")) number = `+972${number.slice(1)}`;
  if (/^\d+$/.test(number)) number = `+${number}`;
  return `whatsapp:${number}`;
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
    connected: await checkTwilioConnection(),
    ownerWhatsApp: ownerWhatsApp || "",
    from: config.twilio.whatsappFrom,
    webhookUrl: config.twilio.webhookUrl,
    connectedAt: integration?.connectedAt ?? null,
  };
}

export async function saveWhatsAppSettings(organizationId: string, ownerWhatsApp: string) {
  const normalized = normalizeWhatsAppNumber(ownerWhatsApp);
  if (!normalized) throw new Error("WhatsApp number is required");

  const integration = await prisma.integration.upsert({
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

  await prisma.$executeRawUnsafe(
    `INSERT INTO "WhatsAppAssistant" ("id","organizationId","ownerPhone","isActive","morningReportTime","clientDailyTime","language","createdAt")
     VALUES ($1,$2,$3,true,'07:30','08:00','he',CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId") DO UPDATE SET "ownerPhone" = EXCLUDED."ownerPhone", "isActive" = true`,
    `waa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    organizationId,
    normalized
  );

  return integration;
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
    where: {
      isActive: true,
      OR: [
        { whatsappNumber: normalized },
        { whatsappNumber: fromNumber },
      ],
    },
  });
}

export async function findOrCreateClientByWhatsAppNumber(organizationId: string, fromNumber: string, profileName?: string) {
  const normalized = normalizeWhatsAppNumber(fromNumber);
  const existing = await prisma.client.findFirst({
    where: {
      organizationId,
      isActive: true,
      OR: [
        { whatsappNumber: normalized },
        { whatsappNumber: fromNumber },
      ],
    },
  });
  if (existing) return { client: existing, created: false };

  const digits = normalized.replace(/^whatsapp:\+?/, "");
  const name = profileName?.trim() || `לקוח וואטסאפ ${digits.slice(-4) || "חדש"}`;
  const client = await prisma.client.create({
    data: {
      organizationId,
      name,
      email: `whatsapp-${digits || Date.now()}@whatsapp.local`,
      whatsappNumber: normalized,
      firstSeen: new Date(),
      lastSeen: new Date(),
      color: "#10B981",
    },
  });
  return { client, created: true };
}

export async function sendWhatsAppMessage(organizationId: string, body: string) {
  const client = await getTwilioClient();
  const settings = await getWhatsAppSettings(organizationId);
  if (!client || !settings.ownerWhatsApp) return { sent: false, reason: "Twilio is not configured" };

  const message = await sendTwilioMessageWithRetry(
    client as TwilioMessageClient,
    {
      from: config.twilio.whatsappFrom,
      to: settings.ownerWhatsApp,
      body,
    },
    { organizationId, to: settings.ownerWhatsApp, target: "owner" }
  );

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

export async function sendWhatsAppToPhone(organizationId: string, phone: string, body: string, clientId?: string, aiGenerated = false) {
  const normalized = normalizeWhatsAppNumber(phone);
  const twilioClient = await getTwilioClient();
  if (!twilioClient) return { sent: false, reason: "Twilio is not configured" };
  if (!normalized) return { sent: false, reason: "WhatsApp number is missing" };

  const message = await sendTwilioMessageWithRetry(
    twilioClient as TwilioMessageClient,
    {
      from: config.twilio.whatsappFrom,
      to: normalized,
      body,
    },
    { organizationId, clientId, to: normalized, target: clientId ? "client" : "owner", aiGenerated }
  );

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      clientId,
      direction: "outbound",
      body,
      fromNumber: config.twilio.whatsappFrom,
      toNumber: normalized,
      aiGenerated,
      read: true,
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
    const message = await sendTwilioMessageWithRetry(
      twilioClient as TwilioMessageClient,
      {
        from: config.twilio.whatsappFrom,
        to: clientRecord.whatsappNumber,
        body,
      },
      {
        organizationId: clientRecord.organizationId,
        clientId,
        to: clientRecord.whatsappNumber,
        target: "client",
        aiGenerated,
      }
    );
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
    console.error("[twilio] send failed", {
      organizationId: clientRecord.organizationId,
      clientId,
      to: clientRecord.whatsappNumber,
      target: "client",
      error: errorMessage(err),
    });
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
