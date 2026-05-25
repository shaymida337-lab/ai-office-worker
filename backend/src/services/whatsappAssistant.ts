import { prisma } from "../lib/prisma.js";
import { clientTemplates, ownerTemplates } from "./messageTemplates.js";
import { notificationGuard } from "./notificationGuard.js";
import { normalizeWhatsAppNumber, sendWhatsAppToPhone } from "./whatsapp.js";

export type WhatsAppAssistantSettings = {
  ownerPhone: string;
  isActive: boolean;
  ownerMorningReport: boolean;
  ownerMorningTime: string;
  ownerCriticalAlerts: boolean;
  clientMorningSummary: boolean;
  clientMorningTime: string;
  clientPaymentReminder: boolean;
  clientPaymentDaysWait: number;
  clientInvoiceFound: boolean;
  clientUrgentOnly: boolean;
  maxMessagesPerDay: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  noMessagesOnSaturday: boolean;
  noMessagesOnHolidays: boolean;
};

const defaults: WhatsAppAssistantSettings = {
  ownerPhone: "",
  isActive: true,
  ownerMorningReport: true,
  ownerMorningTime: "07:30",
  ownerCriticalAlerts: true,
  clientMorningSummary: true,
  clientMorningTime: "08:00",
  clientPaymentReminder: true,
  clientPaymentDaysWait: 7,
  clientInvoiceFound: true,
  clientUrgentOnly: true,
  maxMessagesPerDay: 2,
  quietHoursStart: "21:00",
  quietHoursEnd: "07:00",
  noMessagesOnSaturday: true,
  noMessagesOnHolidays: true,
};

export async function getWhatsAppAssistantSettings(organizationId: string): Promise<WhatsAppAssistantSettings> {
  const assistants = await prisma.$queryRawUnsafe<Array<{ ownerPhone: string; isActive: boolean; morningReportTime: string; clientDailyTime: string }>>(
    'SELECT "ownerPhone","isActive","morningReportTime","clientDailyTime" FROM "WhatsAppAssistant" WHERE "organizationId" = $1 LIMIT 1',
    organizationId
  );
  const rules = await prisma.$queryRawUnsafe<Array<Omit<WhatsAppAssistantSettings, "ownerPhone" | "isActive">>>(
    `SELECT "ownerMorningReport","ownerMorningTime","ownerCriticalAlerts","clientMorningSummary","clientMorningTime","clientPaymentReminder",
      "clientPaymentDaysWait","clientInvoiceFound","clientUrgentOnly","maxMessagesPerDay","quietHoursStart","quietHoursEnd",
      "noMessagesOnSaturday","noMessagesOnHolidays"
     FROM "NotificationRules" WHERE "organizationId" = $1 LIMIT 1`,
    organizationId
  );
  return {
    ...defaults,
    ...(rules[0] ?? {}),
    ownerPhone: assistants[0]?.ownerPhone ?? "",
    isActive: assistants[0]?.isActive ?? true,
    ownerMorningTime: rules[0]?.ownerMorningTime ?? assistants[0]?.morningReportTime ?? defaults.ownerMorningTime,
    clientMorningTime: rules[0]?.clientMorningTime ?? assistants[0]?.clientDailyTime ?? defaults.clientMorningTime,
  };
}

export async function updateWhatsAppAssistantSettings(organizationId: string, input: Partial<WhatsAppAssistantSettings>) {
  const current = await getWhatsAppAssistantSettings(organizationId);
  const next: WhatsAppAssistantSettings = {
    ...current,
    ...input,
    ownerPhone: input.ownerPhone !== undefined ? normalizeWhatsAppNumber(input.ownerPhone) : current.ownerPhone,
    maxMessagesPerDay: clamp(Number(input.maxMessagesPerDay ?? current.maxMessagesPerDay), 1, 3),
    clientPaymentDaysWait: Math.max(1, Number(input.clientPaymentDaysWait ?? current.clientPaymentDaysWait)),
  };

  if (next.ownerPhone) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WhatsAppAssistant" ("id","organizationId","ownerPhone","isActive","morningReportTime","clientDailyTime","language","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,'he',CURRENT_TIMESTAMP)
       ON CONFLICT ("organizationId") DO UPDATE SET "ownerPhone" = EXCLUDED."ownerPhone", "isActive" = EXCLUDED."isActive",
       "morningReportTime" = EXCLUDED."morningReportTime", "clientDailyTime" = EXCLUDED."clientDailyTime"`,
      `waa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      organizationId,
      next.ownerPhone,
      next.isActive,
      next.ownerMorningTime,
      next.clientMorningTime
    );
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "NotificationRules" ("id","organizationId","ownerMorningReport","ownerMorningTime","ownerCriticalAlerts","clientMorningSummary",
      "clientMorningTime","clientPaymentReminder","clientPaymentDaysWait","clientInvoiceFound","clientUrgentOnly","maxMessagesPerDay",
      "quietHoursStart","quietHoursEnd","noMessagesOnSaturday","noMessagesOnHolidays")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT ("organizationId") DO UPDATE SET
      "ownerMorningReport" = EXCLUDED."ownerMorningReport", "ownerMorningTime" = EXCLUDED."ownerMorningTime",
      "ownerCriticalAlerts" = EXCLUDED."ownerCriticalAlerts", "clientMorningSummary" = EXCLUDED."clientMorningSummary",
      "clientMorningTime" = EXCLUDED."clientMorningTime", "clientPaymentReminder" = EXCLUDED."clientPaymentReminder",
      "clientPaymentDaysWait" = EXCLUDED."clientPaymentDaysWait", "clientInvoiceFound" = EXCLUDED."clientInvoiceFound",
      "clientUrgentOnly" = EXCLUDED."clientUrgentOnly", "maxMessagesPerDay" = EXCLUDED."maxMessagesPerDay",
      "quietHoursStart" = EXCLUDED."quietHoursStart", "quietHoursEnd" = EXCLUDED."quietHoursEnd",
      "noMessagesOnSaturday" = EXCLUDED."noMessagesOnSaturday", "noMessagesOnHolidays" = EXCLUDED."noMessagesOnHolidays"`,
    `war_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    organizationId,
    next.ownerMorningReport,
    next.ownerMorningTime,
    next.ownerCriticalAlerts,
    next.clientMorningSummary,
    next.clientMorningTime,
    next.clientPaymentReminder,
    next.clientPaymentDaysWait,
    next.clientInvoiceFound,
    next.clientUrgentOnly,
    next.maxMessagesPerDay,
    next.quietHoursStart,
    next.quietHoursEnd,
    next.noMessagesOnSaturday,
    next.noMessagesOnHolidays
  );

  return getWhatsAppAssistantSettings(organizationId);
}

export async function getWhatsAppAssistantStats(organizationId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [sentRows, conversationRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint as count FROM "WhatsAppNotification" WHERE "organizationId" = $1 AND "sentAt" >= $2',
      organizationId,
      todayStart
    ),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*)::bigint as count FROM "WhatsAppConversation" WHERE "organizationId" = $1 AND "lastMessageAt" >= $2',
      organizationId,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    ),
  ]);
  return { sentToday: Number(sentRows[0]?.count ?? 0), activeChats: Number(conversationRows[0]?.count ?? 0) };
}

export async function sendAssistantTest(organizationId: string, type: "morning" | "number") {
  const settings = await getWhatsAppAssistantSettings(organizationId);
  if (!settings.ownerPhone) return { sent: false, reason: "Owner WhatsApp number is missing" };
  const message =
    type === "morning"
      ? ownerTemplates.morningReport({ activeClients: 0, monthlyIncome: 0, pendingPayments: 0, newEmails: 0, todayTasks: 0 })
      : clientTemplates.urgentAlert({ clientName: "בדיקה", message: "בדיקת WhatsApp Assistant עברה בהצלחה." });

  const canSend = await notificationGuard.canSend(settings.ownerPhone, organizationId, "test");
  if (!canSend.allowed) return { sent: false, reason: canSend.reason };
  const result = await sendWhatsAppToPhone(organizationId, settings.ownerPhone, message, undefined, true);
  if (result.sent) await notificationGuard.logSent(settings.ownerPhone, organizationId, "test", message, undefined, true);
  return result;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
