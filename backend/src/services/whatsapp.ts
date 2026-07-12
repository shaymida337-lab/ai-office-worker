import { config, hasTwilio, missingTwilioEnvVars, twilioEnvDiagnostics } from "../lib/config.js";
import { isProduction } from "../lib/productionGuard.js";
import { prisma } from "../lib/prisma.js";
import { getDashboardStats } from "./dashboard.js";
import {
  buildNatalieCommandHelp,
  buildNatalieErrorFallback,
  buildNatalieInvoiceFound,
  buildNatalieTestMessage,
  buildNatalieUnknownCommand,
  formatSupplierDisplayName,
  sanitizeWhatsAppText,
} from "./whatsapp/natalieWhatsAppUx.js";

type WhatsAppMetadata = { ownerWhatsApp?: string };
type TwilioAccountClient = TwilioMessageClient & {
  api: {
    accounts(sid: string): {
      fetch(): Promise<{ sid?: string; status?: string; friendlyName?: string }>;
    };
  };
};
type TwilioMessageClient = {
  messages: {
    create(args: { from: string | undefined; to: string; body: string }): Promise<{ sid: string }>;
  };
};

const TWILIO_SEND_RETRIES = 2;

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function twilioErrorDetails(err: unknown) {
  const candidate = err as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    moreInfo?: unknown;
    details?: unknown;
  };
  return {
    message: errorMessage(err),
    code: candidate.code ?? null,
    status: candidate.status ?? null,
    moreInfo: candidate.moreInfo ?? null,
    details: candidate.details ?? null,
  };
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

export function getWhatsAppProvider() {
  return "twilio_whatsapp" as const;
}

export function getWhatsAppConfigurationStatus() {
  const missingVariables = missingTwilioEnvVars();
  return {
    provider: getWhatsAppProvider(),
    configured: missingVariables.length === 0,
    missingVariables,
    requiredVariables: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_WHATSAPP_NUMBER",
    ],
    optionalVariables: [
      "TWILIO_WEBHOOK_URL",
      "OWNER_WHATSAPP",
    ],
    from: config.twilio.whatsappFrom,
    webhookUrl: config.twilio.webhookUrl,
    messageProcessingEnabled: config.twilio.messageProcessingEnabled,
    mediaIngestionEnabled: config.twilio.mediaIngestionEnabled,
    autoReplyEnabled: config.twilio.autoReplyEnabled,
    createClientsEnabled: config.twilio.createClientsEnabled,
    webEnabled: config.twilio.webEnabled,
    webhookUrls: [
      config.twilio.webhookUrl,
      config.twilio.webhookUrl.replace("/webhook/", "/api/webhook/"),
      `${config.twilio.webhookUrl.replace(/\/(?:api\/)?webhook\/whatsapp$/, "")}/webhook/twilio/whatsapp`,
      `${config.twilio.webhookUrl.replace(/\/(?:api\/)?webhook\/whatsapp$/, "")}/api/webhook/twilio/whatsapp`,
    ],
    envDiagnostics: isProduction()
      ? { configured: missingVariables.length === 0 }
      : twilioEnvDiagnostics(),
  };
}

async function getTwilioClient() {
  if (!hasTwilio()) return null;
  const twilio = (await import("twilio")).default;
  return twilio(config.twilio.accountSid, config.twilio.authToken) as TwilioAccountClient;
}

export async function checkTwilioConnection() {
  const configuration = getWhatsAppConfigurationStatus();
  if (!configuration.configured) {
    return {
      connected: false,
      reason: "WhatsApp configuration missing",
      missingVariables: configuration.missingVariables,
      account: null,
    };
  }
  const client = await getTwilioClient();
  if (!client) {
    return {
      connected: false,
      reason: "WhatsApp configuration missing",
      missingVariables: configuration.missingVariables,
      account: null,
    };
  }
  try {
    const account = await client.api.accounts(config.twilio.accountSid).fetch();
    return {
      connected: true,
      reason: null,
      missingVariables: [],
      account: {
        sid: account.sid ?? config.twilio.accountSid,
        status: account.status ?? null,
        friendlyName: account.friendlyName ?? null,
      },
    };
  } catch (err) {
    console.error("[twilio] connection check failed", err instanceof Error ? err.message : String(err));
    return {
      connected: false,
      reason: err instanceof Error ? err.message : String(err),
      missingVariables: [],
      account: null,
    };
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

  const configuration = getWhatsAppConfigurationStatus();
  const connection = await checkTwilioConnection();
  return {
    provider: configuration.provider,
    configured: configuration.configured,
    connected: connection.connected,
    reason: connection.reason,
    missingVariables: connection.missingVariables,
    account: connection.account,
    ownerWhatsApp: ownerWhatsApp || "",
    from: configuration.from,
    webhookUrl: configuration.webhookUrl,
    webhookUrls: configuration.webhookUrls,
    connectedAt: integration?.connectedAt ?? null,
    diagnostics: isProduction()
      ? {
          twilioApiStatus: connection.connected ? "PASS" : "FAIL",
          configured: configuration.configured,
          missingVariables: configuration.missingVariables,
          messageProcessingEnabled: configuration.messageProcessingEnabled,
          mediaIngestionEnabled: configuration.mediaIngestionEnabled,
          autoReplyEnabled: configuration.autoReplyEnabled,
          createClientsEnabled: configuration.createClientsEnabled,
          webEnabled: configuration.webEnabled,
        }
      : {
          accountSid: (configuration.envDiagnostics as ReturnType<typeof twilioEnvDiagnostics>).TWILIO_ACCOUNT_SID,
          authToken: (configuration.envDiagnostics as ReturnType<typeof twilioEnvDiagnostics>).TWILIO_AUTH_TOKEN,
          whatsappNumber: (configuration.envDiagnostics as ReturnType<typeof twilioEnvDiagnostics>).TWILIO_WHATSAPP_NUMBER,
          whatsappFrom: (configuration.envDiagnostics as ReturnType<typeof twilioEnvDiagnostics>).TWILIO_WHATSAPP_FROM,
          twilioApiStatus: connection.connected ? "PASS" : "FAIL",
          account: connection.account,
          lastError: connection.reason,
          missingVariables: configuration.missingVariables,
          messageProcessingEnabled: configuration.messageProcessingEnabled,
          mediaIngestionEnabled: configuration.mediaIngestionEnabled,
          autoReplyEnabled: configuration.autoReplyEnabled,
          createClientsEnabled: configuration.createClientsEnabled,
          webEnabled: configuration.webEnabled,
        },
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
  const matches = integrations.filter((integration) => parseMetadata(integration.metadata).ownerWhatsApp === normalized);
  if (matches.length === 1) return matches[0].organizationId;

  if (
    config.twilio.ownerWhatsApp &&
    normalizeWhatsAppNumber(config.twilio.ownerWhatsApp) === normalized
  ) {
    const assistants = await prisma.$queryRawUnsafe<Array<{ organizationId: string }>>(
      'SELECT "organizationId" FROM "WhatsAppAssistant" WHERE "ownerPhone" = $1 AND "isActive" = true LIMIT 2',
      normalized
    );
    if (assistants.length === 1) return assistants[0].organizationId;
  }
  return null;
}

export async function findClientByWhatsAppNumber(fromNumber: string, organizationId?: string) {
  const normalized = normalizeWhatsAppNumber(fromNumber);
  const matches = await prisma.client.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      isActive: true,
      OR: [
        { whatsappNumber: normalized },
        { whatsappNumber: fromNumber },
      ],
    },
    take: 2,
  });
  if (organizationId) {
    return matches[0] ?? null;
  }
  if (matches.length !== 1) return null;
  return matches[0];
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
      email: null,
      emailIsPlaceholder: false,
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

  const sanitizedBody = sanitizeWhatsAppText(body);
  const message = await sendTwilioMessageWithRetry(
    client as TwilioMessageClient,
    {
      from: config.twilio.whatsappFrom,
      to: settings.ownerWhatsApp,
      body: sanitizedBody,
    },
    { organizationId, to: settings.ownerWhatsApp, target: "owner" }
  );

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      direction: "outbound",
      body: sanitizedBody,
      toNumber: settings.ownerWhatsApp,
      fromNumber: config.twilio.whatsappFrom,
    },
  });

  return { sent: true, sid: message.sid };
}

export async function testWhatsAppConnection(organizationId: string) {
  const settings = await getWhatsAppSettings(organizationId);
  if (!settings.configured) {
    console.error("[twilio] test send blocked by missing configuration", {
      organizationId,
      missingVariables: settings.missingVariables,
      diagnostics: settings.diagnostics,
    });
    return {
      sent: false,
      connected: false,
      reason: "WhatsApp configuration missing",
      diagnostics: settings.diagnostics,
      error: { message: `Missing variables: ${settings.missingVariables.join(", ")}` },
    };
  }
  if (!settings.connected) {
    console.error("[twilio] test send blocked by failed API connection", {
      organizationId,
      reason: settings.reason,
      diagnostics: settings.diagnostics,
    });
    return {
      sent: false,
      connected: false,
      reason: "Twilio API connection failed",
      diagnostics: settings.diagnostics,
      error: { message: settings.reason ?? "Twilio API connection failed" },
    };
  }
  if (!settings.ownerWhatsApp) {
    console.error("[twilio] test send blocked by missing owner number", {
      organizationId,
      from: settings.from,
    });
    return {
      sent: false,
      connected: false,
      reason: "Owner WhatsApp number is not configured",
      diagnostics: settings.diagnostics,
      error: { message: "Set owner WhatsApp number before sending a test message" },
    };
  }

  try {
    const result = await sendWhatsAppMessage(
      organizationId,
      buildNatalieTestMessage()
    );
    return {
      ...result,
      connected: result.sent,
      reason: result.sent ? null : result.reason ?? "WhatsApp test message failed",
      to: settings.ownerWhatsApp,
      from: settings.from,
      diagnostics: {
        ...settings.diagnostics,
        twilioApiStatus: result.sent ? "PASS" : settings.diagnostics.twilioApiStatus,
        lastError: result.sent ? null : result.reason ?? settings.diagnostics.lastError,
      },
    };
  } catch (err) {
    const details = twilioErrorDetails(err);
    console.error("[twilio] test send failed", {
      organizationId,
      to: settings.ownerWhatsApp,
      from: settings.from,
      error: details,
    });
    return {
      sent: false,
      connected: false,
      reason: details.message,
      to: settings.ownerWhatsApp,
      from: settings.from,
      diagnostics: {
        ...settings.diagnostics,
        twilioApiStatus: "FAIL",
        lastError: details.message,
      },
      error: details,
    };
  }
}

export async function sendWhatsAppToPhone(organizationId: string, phone: string, body: string, clientId?: string, aiGenerated = false) {
  const normalized = normalizeWhatsAppNumber(phone);
  const twilioClient = await getTwilioClient();
  if (!twilioClient) return { sent: false, reason: "Twilio is not configured" };
  if (!normalized) return { sent: false, reason: "WhatsApp number is missing" };

  const sanitizedBody = sanitizeWhatsAppText(body);
  const message = await sendTwilioMessageWithRetry(
    twilioClient as TwilioMessageClient,
    {
      from: config.twilio.whatsappFrom,
      to: normalized,
      body: sanitizedBody,
    },
    { organizationId, clientId, to: normalized, target: clientId ? "client" : "owner", aiGenerated }
  );

  await prisma.whatsAppLog.create({
    data: {
      organizationId,
      clientId,
      direction: "outbound",
      body: sanitizedBody,
      fromNumber: config.twilio.whatsappFrom,
      toNumber: normalized,
      aiGenerated,
      read: true,
    },
  });

  return { sent: true, sid: message.sid };
}

export async function sendClientWhatsAppMessage(
  organizationId: string,
  clientId: string,
  body: string,
  aiGenerated = false
) {
  const clientRecord = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
  });
  if (!clientRecord?.whatsappNumber) return { sent: false, reason: "Client WhatsApp number is missing" };

  const twilioClient = await getTwilioClient();
  if (!twilioClient) return { sent: false, reason: "Twilio is not configured" };

  try {
    const sanitizedBody = sanitizeWhatsAppText(body);
    const message = await sendTwilioMessageWithRetry(
      twilioClient as TwilioMessageClient,
      {
        from: config.twilio.whatsappFrom,
        to: clientRecord.whatsappNumber,
        body: sanitizedBody,
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
        body: sanitizedBody,
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
  if (!text) return buildNatalieErrorFallback();
  if (/חשבונית|invoice|קבלה|receipt/i.test(text)) {
    return sanitizeWhatsAppText("תודה, קיבלתי את המסמך 😊 אבדוק אותו ואעדכן אם חסר משהו.");
  }
  if (/סטטוס|status/i.test(text)) {
    return sanitizeWhatsAppText("קיבלתי את הפנייה. אבדוק את הסטטוס ואחזור אליך בקרוב.");
  }
  return sanitizeWhatsAppText("תודה על ההודעה! אחזור אליך בהקדם 😊");
}

export async function notifyNewInvoice(
  organizationId: string,
  supplier: string,
  amount: number | null
) {
  const msg = buildNatalieInvoiceFound({
    clientName: "",
    amount: amount ?? 0,
    from: formatSupplierDisplayName(supplier),
    workflowStatus: "needs_review",
  });
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
      return buildNatalieCommandHelp();
    case "STATUS":
    case "מצב": {
      const s = await getDashboardStats(organizationId);
      return sanitizeWhatsAppText(
        [
          "מבט מהיר על העסק:",
          `💰 לתשלום: ₪${s.moneyToPay.toLocaleString("he-IL")}`,
          `📄 חשבוניות חסרות: ${s.missingInvoicesCount}`,
          `✅ משימות פתוחות: ${s.openTasks}`,
        ].join("\n")
      );
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
      return sanitizeWhatsAppText(`סיימתי לסנכרן את המיילים 📬\nנמצאו ${r.emailsProcessed} מיילים ו-${r.paymentsCreated} תשלומים חדשים.`);
    }
    case "PAYMENTS":
    case "תשלומים": {
      const open = await prisma.supplierPayment.findMany({
        where: { organizationId, paid: false, paymentRequired: true },
        take: 10,
        orderBy: { dueDate: "asc" },
      });
      if (!open.length) return sanitizeWhatsAppText("אין תשלומים פתוחים כרגע 👍");
      return sanitizeWhatsAppText(
        open
          .map(
            (p) =>
              `• ${formatSupplierDisplayName(p.supplier)} — ₪${p.amount.toLocaleString("he-IL")}${
                p.dueDate ? ` עד ${p.dueDate.toLocaleDateString("he-IL")}` : ""
              }`
          )
          .join("\n")
      );
    }
    case "MISSING":
    case "חסרות": {
      const m = await prisma.supplierPayment.findMany({
        where: { organizationId, missingInvoice: true, paid: false },
        take: 10,
      });
      if (!m.length) return sanitizeWhatsAppText("אין חשבוניות חסרות כרגע 👍");
      return sanitizeWhatsAppText(
        m.map((p) => `• ${formatSupplierDisplayName(p.supplier)} — ₪${p.amount.toLocaleString("he-IL")}`).join("\n")
      );
    }
    default:
      return buildNatalieUnknownCommand();
  }
}

/**
 * התראת פלטפורמה לבעלים של נטלי (לא הודעת tenant): נשלחת למספר
 * OWNER_WHATSAPP הגלובלי, בלי רישום ב-whatsAppLog של ארגון.
 */
export async function sendPlatformAlert(body: string): Promise<{ sent: boolean; reason?: string }> {
  const to = normalizeWhatsAppNumber(config.twilio.ownerWhatsApp || "");
  if (!to) return { sent: false, reason: "OWNER_WHATSAPP is not configured" };
  const twilioClient = await getTwilioClient();
  if (!twilioClient) return { sent: false, reason: "Twilio is not configured" };
  try {
    await (twilioClient as unknown as TwilioMessageClient).messages.create({
      from: config.twilio.whatsappFrom,
      to,
      body: sanitizeWhatsAppText(body),
    });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "send failed" };
  }
}
