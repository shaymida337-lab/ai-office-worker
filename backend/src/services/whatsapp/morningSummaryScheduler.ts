import { prisma } from "../../lib/prisma.js";
import { getDayBounds, getLocalTimeParts } from "../calendar/datetime.js";

export const MORNING_SUMMARY_TIMEZONE = "Asia/Jerusalem";
/** Fires at 08:00 Sunday–Friday in Asia/Jerusalem */
export const MORNING_SUMMARY_CRON_EXPRESSION = "0 8 * * 0-5";
export const MORNING_SUMMARY_WINDOW_START_HOUR = 8;
export const MORNING_SUMMARY_WINDOW_END_HOUR = 9;
export const MORNING_SUMMARY_HARD_BLOCK_START_HOUR = 22;
export const MORNING_SUMMARY_HARD_BLOCK_END_HOUR = 7;

export type MorningSummaryTrigger =
  | "cron_scheduler_owner"
  | "cron_scheduler_client"
  | "cron_worker"
  | "cron_external"
  | "send_daily_summary"
  | "manual_test";

export type MorningSummaryDecision =
  | { action: "send"; reason: string }
  | { action: "skip"; reason: string };

export function getOrganizationMorningTimezone(orgTimezone?: string | null): string {
  const trimmed = orgTimezone?.trim();
  return trimmed || MORNING_SUMMARY_TIMEZONE;
}

export function getLocalWeekday(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}

export function getLocalDayKey(now: Date, timeZone: string): string {
  const local = getLocalTimeParts(now, timeZone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

export function formatMorningSummaryLogContext(now: Date, timeZone: string) {
  const local = getLocalTimeParts(now, timeZone);
  return {
    utcTime: now.toISOString(),
    localTime: `${getLocalDayKey(now, timeZone)} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
    organizationTimezone: timeZone,
    localHour: local.hour,
    localMinute: local.minute,
    localWeekday: getLocalWeekday(now, timeZone),
  };
}

export function isHardBlockedLocalTime(hour: number): boolean {
  return hour >= MORNING_SUMMARY_HARD_BLOCK_START_HOUR || hour < MORNING_SUMMARY_HARD_BLOCK_END_HOUR;
}

export function isInMorningSendWindow(hour: number, minute: number): boolean {
  const minutes = hour * 60 + minute;
  const windowStart = MORNING_SUMMARY_WINDOW_START_HOUR * 60;
  const windowEnd = MORNING_SUMMARY_WINDOW_END_HOUR * 60;
  return minutes >= windowStart && minutes < windowEnd;
}

export function evaluateMorningSummarySend(params: {
  now: Date;
  timeZone: string;
  trigger: string;
  alreadySentToday?: boolean;
  forceTest?: boolean;
}): MorningSummaryDecision {
  const { now, timeZone, trigger, alreadySentToday, forceTest } = params;
  const local = getLocalTimeParts(now, timeZone);

  if (alreadySentToday) {
    return { action: "skip", reason: "duplicate_already_sent_today" };
  }

  if (getLocalWeekday(now, timeZone) === 6) {
    return { action: "skip", reason: "saturday" };
  }

  if (isHardBlockedLocalTime(local.hour)) {
    return { action: "skip", reason: "hard_night_block_22_to_07" };
  }

  if (!forceTest && !isInMorningSendWindow(local.hour, local.minute)) {
    const minutes = local.hour * 60 + local.minute;
    if (minutes < MORNING_SUMMARY_WINDOW_START_HOUR * 60) {
      return { action: "skip", reason: "before_send_window_wait_until_08" };
    }
    return { action: "skip", reason: "after_send_window_wait_until_tomorrow" };
  }

  return {
    action: "send",
    reason: forceTest ? "manual_test_override" : `in_send_window_trigger_${trigger}`,
  };
}

export async function hasMorningSummarySentTodayForOrg(
  organizationId: string,
  timeZone: string,
  now = new Date()
): Promise<boolean> {
  const { start, end } = getDayBounds(now, timeZone);

  const syncLog = await prisma.syncLog.findFirst({
    where: {
      organizationId,
      type: "whatsapp_morning",
      status: "success",
      finishedAt: { gte: start, lt: end },
    },
    select: { id: true },
  });
  if (syncLog) return true;

  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "WhatsAppNotification" WHERE "organizationId" = $1 AND "type" = $2 AND "sentAt" >= $3 AND "sentAt" < $4 LIMIT 1',
    organizationId,
    "morning_report",
    start,
    end
  );
  return Boolean(rows[0]);
}

export function logMorningSummarySchedulerEvent(params: {
  trigger: string;
  organizationId?: string;
  decision: MorningSummaryDecision;
  now: Date;
  timeZone: string;
}) {
  const context = formatMorningSummaryLogContext(params.now, params.timeZone);
  const orgSuffix = params.organizationId ? ` org=${params.organizationId}` : "";
  console.log(
    `[morning-summary] scheduler_fired trigger=${params.trigger}${orgSuffix} action=${params.decision.action} reason=${params.decision.reason}`,
    context
  );
}

export async function requestMorningSummarySend(params: {
  organizationId: string;
  trigger: MorningSummaryTrigger;
  now?: Date;
  forceTest?: boolean;
}): Promise<MorningSummaryDecision> {
  const now = params.now ?? new Date();
  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { timezone: true },
  });
  const timeZone = getOrganizationMorningTimezone(org?.timezone);
  const alreadySentToday = await hasMorningSummarySentTodayForOrg(params.organizationId, timeZone, now);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone,
    trigger: params.trigger,
    alreadySentToday,
    forceTest: params.forceTest,
  });
  logMorningSummarySchedulerEvent({
    trigger: params.trigger,
    organizationId: params.organizationId,
    decision,
    now,
    timeZone,
  });
  return decision;
}
