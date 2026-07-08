import { resolveAppointmentDateTime } from "../appointmentService.js";
import {
  findUpcomingSchedulingForOrganizationDetailed,
  type UpcomingSchedulingItem,
} from "../scheduling/schedulingFacade.js";
import { buildLastListedAppointmentsPendingAction } from "../conversation/lastListedAppointments.js";
import type { CalendarIntentExtraction, CalendarListRange } from "./calendarIntentParser.js";
import { calendarMessages } from "./calendarMessages.js";

export type CalendarReadMode = "list" | "count" | "count_clients" | "next";

export type CalendarReadQuery = {
  rangeType?: CalendarListRange;
  dayReference: string | null;
  readMode: CalendarReadMode;
  /** For next-mode: emphasize client name vs full appointment details. */
  nextFocus?: "appointment" | "client" | "now";
};

export type CalendarReadEngineDeps = {
  now?: Date;
  loadDetailed?: typeof findUpcomingSchedulingForOrganizationDetailed;
};

export type CalendarReadEngineResult = {
  answer: string;
  action?: "last_listed_appointments";
  proposal?: Record<string, unknown>;
};

/** YYYY-MM-DD wall-clock date in the business timezone. */
export function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const HEBREW_SHORT_WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function endOfCurrentWeekLocalDate(now: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
  const dayIndex = HEBREW_SHORT_WEEKDAY_TO_INDEX[weekday] ?? 0;
  const daysUntilSaturday = 6 - dayIndex;
  return localDateInTimeZone(new Date(now.getTime() + daysUntilSaturday * 86_400_000), timeZone);
}

/**
 * Filter merged upcoming items to the requested read window. Items stay in
 * chronological order (repository already sorts by start time).
 */
export function filterAppointmentsForReadRange(
  items: Array<UpcomingSchedulingItem & { clientId?: string }>,
  params: { rangeType?: CalendarListRange; dayReference: string | null; timeZone: string; now: Date }
): Array<UpcomingSchedulingItem & { clientId?: string }> {
  if (params.rangeType === "week") {
    const endLocal = endOfCurrentWeekLocalDate(params.now, params.timeZone);
    return items.filter((item) => localDateInTimeZone(item.startTime, params.timeZone) <= endLocal);
  }
  if (params.dayReference) {
    const target = resolveAppointmentDateTime({
      dayReference: params.dayReference,
      time: "12:00",
      timeZone: params.timeZone,
      now: params.now,
    });
    if (!target) return items;
    const targetLocal = localDateInTimeZone(target, params.timeZone);
    return items.filter((item) => localDateInTimeZone(item.startTime, params.timeZone) === targetLocal);
  }
  return items;
}

function sortAppointmentsChronologically<T extends { startTime: Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

function formatTimeOnly(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatAppointmentWhen(startTime: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startTime);
}

function formatListEntry(
  item: UpcomingSchedulingItem,
  timeZone: string,
  includeDate: boolean
): string {
  const when = includeDate
    ? formatAppointmentWhen(item.startTime, timeZone)
    : formatTimeOnly(item.startTime, timeZone);
  return calendarMessages.listEntry({
    when,
    clientName: item.clientName,
    serviceName: item.serviceName,
  });
}

function listRangeLabel(rangeType: CalendarListRange | undefined, dayReference: string | null): {
  header: string;
  empty: string;
  includeDate: boolean;
} {
  if (rangeType === "week") {
    return {
      header: calendarMessages.listHeaderWeek(),
      empty: calendarMessages.listEmptyWeek(),
      includeDate: true,
    };
  }
  if (dayReference) {
    return {
      header: calendarMessages.listHeaderDay(dayReference),
      empty: calendarMessages.listEmptyDay(dayReference),
      includeDate: false,
    };
  }
  return {
    header: calendarMessages.listHeaderAll(),
    empty: calendarMessages.listEmptyAll(),
    includeDate: true,
  };
}

function uniqueClientCount(items: Array<UpcomingSchedulingItem & { clientId?: string }>): number {
  const keys = new Set<string>();
  for (const item of items) {
    const key = item.clientId?.trim() || item.clientName.trim().toLowerCase();
    if (key) keys.add(key);
  }
  return keys.size;
}

function findCurrentOrNextAppointment(
  items: Array<UpcomingSchedulingItem & { clientId?: string }>,
  now: Date
): (UpcomingSchedulingItem & { clientId?: string }) | null {
  for (const item of items) {
    const end = new Date(item.startTime.getTime() + item.durationMinutes * 60_000);
    if (item.startTime.getTime() <= now.getTime() && now.getTime() < end.getTime()) {
      return item;
    }
  }
  const upcoming = items.filter((item) => item.startTime.getTime() >= now.getTime());
  return upcoming[0] ?? null;
}

function buildSourceLine(
  detailed: Awaited<ReturnType<typeof findUpcomingSchedulingForOrganizationDetailed>>
): string {
  const googleWarning = detailed.googleReadWarningHe;
  if (detailed.googleReadStatus === "full") return calendarMessages.listSourceFull();
  if (detailed.googleReadStatus === "partial") {
    return calendarMessages.listSourcePartial(googleWarning);
  }
  if (detailed.googleReadStatus === "local_only") return calendarMessages.listSourceLocalOnly();
  return calendarMessages.listSourceUnavailable(googleWarning);
}

function buildEmptyAnswer(
  empty: string,
  detailed: Awaited<ReturnType<typeof findUpcomingSchedulingForOrganizationDetailed>>
): string {
  const sourceLine = buildSourceLine(detailed);
  const googleWarning = detailed.googleReadWarningHe;
  if (detailed.googleReadStatus !== "full") {
    return `${calendarMessages.listCannotGuaranteeEmpty(googleWarning)}\n\n${sourceLine}`;
  }
  const answer = googleWarning ? calendarMessages.listEmptyWithGoogleWarning(empty, googleWarning) : empty;
  return `${answer}\n\n${sourceLine}`;
}

export function calendarReadQueryFromIntent(intent: CalendarIntentExtraction): CalendarReadQuery | null {
  if (intent.intent !== "list_appointments") return null;
  return {
    rangeType: intent.rangeType,
    dayReference: intent.dayReference,
    readMode: intent.readMode ?? "list",
    nextFocus: intent.nextFocus,
  };
}

export async function runCalendarReadEngine(params: {
  organizationId: string;
  query: CalendarReadQuery;
  timeZone: string;
  now?: Date;
  requestId?: string | null;
  deps?: CalendarReadEngineDeps;
}): Promise<CalendarReadEngineResult> {
  const now = params.now ?? params.deps?.now ?? new Date();
  const loadDetailed = params.deps?.loadDetailed ?? findUpcomingSchedulingForOrganizationDetailed;

  const lookbackMs =
    params.query.readMode === "next" && params.query.nextFocus === "now" ? 4 * 60 * 60_000 : 0;
  const readFrom = new Date(now.getTime() - lookbackMs);

  let detailed: Awaited<ReturnType<typeof findUpcomingSchedulingForOrganizationDetailed>>;
  try {
    detailed = await loadDetailed({
      organizationId: params.organizationId,
      now: readFrom,
    });
  } catch (err) {
    console.error("[calendarReadEngine] scheduling read failed", err);
    return { answer: "לא הצלחתי לקרוא את היומן כרגע. נסי שוב בעוד רגע." };
  }

  const filtered = sortAppointmentsChronologically(
    filterAppointmentsForReadRange(detailed.items, {
      rangeType: params.query.readMode === "next" ? "all" : params.query.rangeType,
      dayReference: params.query.readMode === "next" ? null : params.query.dayReference,
      timeZone: params.timeZone,
      now,
    })
  );

  console.info("[natalie/google-truth] calendar-read", {
    requestId: params.requestId ?? null,
    organizationId: params.organizationId,
    readMode: params.query.readMode,
    googleStatus: detailed.googleReadStatus,
    degraded: detailed.googleReadDegraded,
    reason: detailed.googleReadReason ?? null,
    statusCode: detailed.googleReadStatusCode ?? null,
    sourceUsed: detailed.googleReadStatus === "full" ? "google+local" : "local_or_partial",
  });

  const sourceLine = buildSourceLine(detailed);
  const googleWarning = detailed.googleReadWarningHe;

  if (params.query.readMode === "next") {
    const next = findCurrentOrNextAppointment(filtered, now);
    if (!next) {
      return { answer: buildEmptyAnswer(calendarMessages.nextAppointmentEmpty(), detailed) };
    }
    const when = formatAppointmentWhen(next.startTime, params.timeZone);
    const answer =
      params.query.nextFocus === "client"
        ? calendarMessages.nextClient(next.clientName, when)
        : calendarMessages.nextAppointment(next.clientName, when, next.serviceName);
    const answerWithSource = `${answer}\n\n${sourceLine}`;
    const listedPending = buildLastListedAppointmentsPendingAction([next]);
    return {
      action: "last_listed_appointments",
      proposal: listedPending!.proposal as Record<string, unknown>,
      answer: answerWithSource,
    };
  }

  if (params.query.readMode === "count" || params.query.readMode === "count_clients") {
    const { empty } = listRangeLabel(params.query.rangeType, params.query.dayReference);
    if (filtered.length === 0) {
      return { answer: buildEmptyAnswer(empty, detailed) };
    }
    const count =
      params.query.readMode === "count_clients" ? uniqueClientCount(filtered) : filtered.length;
    const countLine =
      params.query.readMode === "count_clients"
        ? calendarMessages.countClients(params.query.dayReference, params.query.rangeType, count)
        : calendarMessages.countAppointments(params.query.dayReference, params.query.rangeType, count);
    return { answer: `${countLine}\n\n${sourceLine}` };
  }

  const { header, empty, includeDate } = listRangeLabel(params.query.rangeType, params.query.dayReference);

  if (filtered.length === 0) {
    return { answer: buildEmptyAnswer(empty, detailed) };
  }

  const lines = filtered.map((item) => formatListEntry(item, params.timeZone, includeDate));
  const answer = googleWarning
    ? calendarMessages.listWithGoogleWarning(header, lines.join("\n"), googleWarning)
    : `${header}\n${lines.join("\n")}`;
  const answerWithSource = `${answer}\n\n${sourceLine}`;
  const listedPending = buildLastListedAppointmentsPendingAction(filtered);
  return {
    action: "last_listed_appointments",
    proposal: listedPending!.proposal as Record<string, unknown>,
    answer: answerWithSource,
  };
}
