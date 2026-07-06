import { prisma } from "../lib/prisma.js";
import { getDayBounds, getLocalTimeParts } from "./calendar/datetime.js";
import { getLocalWeekday, MORNING_SUMMARY_TIMEZONE } from "./whatsapp/morningSummaryScheduler.js";

type Rules = {
  maxMessagesPerDay: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  noMessagesOnSaturday: boolean;
};

class NotificationGuard {
  async canSend(phone: string, organizationId: string, type: string): Promise<{ allowed: boolean; reason?: string }> {
    const [rules, org] = await Promise.all([
      getRules(organizationId),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    ]);
    const timeZone = org?.timezone?.trim() || MORNING_SUMMARY_TIMEZONE;
    const now = new Date();

    // RULE: No messages 21:00-07:00 (organization local time)
    if (isInQuietHours(now, rules.quietHoursStart, rules.quietHoursEnd, timeZone)) {
      return { allowed: false, reason: "quiet_hours" };
    }

    // RULE: No messages on Saturday (organization local time)
    if (getLocalWeekday(now, timeZone) === 6 && rules.noMessagesOnSaturday) {
      return { allowed: false, reason: "saturday" };
    }

    const { start: todayStart } = getDayBounds(now, timeZone);

    const todayCount = await countNotifications(phone, todayStart);
    // RULE: Max 2 messages per day per number
    if (todayCount >= rules.maxMessagesPerDay) {
      return { allowed: false, reason: "daily_limit_reached" };
    }

    // RULE: Payment reminder max once per 7 days
    if (type === "payment_reminder") {
      const recent = await findRecentNotification(phone, type, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      if (recent) return { allowed: false, reason: "too_soon_for_reminder" };
    }

    return { allowed: true };
  }

  async logSent(phone: string, organizationId: string, type: string, message: string, clientId?: string, isOwner = false) {
    await prisma.$executeRawUnsafe(
      'INSERT INTO "WhatsAppNotification" ("id","organizationId","clientId","phone","type","message","isOwner","sentAt") VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)',
      `wan_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      organizationId,
      clientId ?? null,
      phone,
      type,
      message,
      isOwner
    );
  }
}

async function getRules(organizationId: string): Promise<Rules> {
  const rows = await prisma.$queryRawUnsafe<Rules[]>(
    'SELECT "maxMessagesPerDay","quietHoursStart","quietHoursEnd","noMessagesOnSaturday" FROM "NotificationRules" WHERE "organizationId" = $1 LIMIT 1',
    organizationId
  );
  return rows[0] ?? { maxMessagesPerDay: 2, quietHoursStart: "21:00", quietHoursEnd: "07:00", noMessagesOnSaturday: true };
}

async function countNotifications(phone: string, since: Date) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    'SELECT COUNT(*)::bigint as count FROM "WhatsAppNotification" WHERE "phone" = $1 AND "sentAt" >= $2',
    phone,
    since
  );
  return Number(rows[0]?.count ?? 0);
}

async function findRecentNotification(phone: string, type: string, since: Date) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "WhatsAppNotification" WHERE "phone" = $1 AND "type" = $2 AND "sentAt" >= $3 LIMIT 1',
    phone,
    type,
    since
  );
  return rows[0] ?? null;
}

function isInQuietHours(date: Date, start: string, end: string, timeZone: string) {
  const local = getLocalTimeParts(date, timeZone);
  const current = local.hour * 60 + local.minute;
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);
  return startMinutes > endMinutes ? current >= startMinutes || current < endMinutes : current >= startMinutes && current < endMinutes;
}

function parseTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export const notificationGuard = new NotificationGuard();
