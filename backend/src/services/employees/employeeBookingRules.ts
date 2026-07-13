/**
 * Calendar Phase 1 — חוקי הזמנה לעובד: שעות עבודה, הפסקות, חופשות וכפילויות.
 *
 * מודול טהור (ללא DB) — כל הבדיקות מקבלות נתונים מוכנים ומחזירות הכרעה,
 * כך שכל חוק ניתן לבדיקה ביחידה. חישובי "יום/שעה מקומיים" נעשים ב-timezone
 * של הארגון, לא בשעון השרת.
 */

export type WeeklyScheduleEntry = {
  /** 0=ראשון .. 6=שבת (כמו getDay) */
  dayOfWeek: number;
  /** "HH:MM" בשעון הארגון */
  startTime: string;
  endTime: string;
  breaks: Array<{ start: string; end: string }>;
};

export type VacationRange = {
  /** "YYYY-MM-DD" מקומי, כולל */
  startDate: string;
  /** "YYYY-MM-DD" מקומי, כולל */
  endDate: string;
};

export type BookingInterval = {
  start: Date;
  end: Date;
};

export type EmployeeBookingRejection =
  | { ok: false; code: "outside_working_hours"; message: string }
  | { ok: false; code: "on_vacation"; message: string }
  | { ok: false; code: "time_conflict"; message: string };

export type EmployeeBookingDecision = { ok: true } | EmployeeBookingRejection;

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function parseTimeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidLocalDateKey(value: string): boolean {
  return DATE_PATTERN.test(value.trim());
}

/** מפתח תאריך מקומי "YYYY-MM-DD" של רגע נתון ב-timezone הארגון. */
export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** יום בשבוע מקומי (0=ראשון..6=שבת) ב-timezone הארגון. */
export function localWeekday(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}

/** דקות מחצות מקומית ב-timezone הארגון. */
export function localMinutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // Intl עשוי להחזיר hour=24 עבור חצות בחלק מהסביבות — מנרמלים ל-0.
  return (get("hour") % 24) * 60 + get("minute");
}

export type ScheduleValidationResult =
  | { ok: true; entries: WeeklyScheduleEntry[] }
  | { ok: false; error: string };

/** ולידציה + נרמול של לוח שבועי שמגיע מה-API. */
export function validateWeeklySchedule(raw: unknown): ScheduleValidationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "workingHours must be an array" };
  }
  const seenDays = new Set<number>();
  const entries: WeeklyScheduleEntry[] = [];
  for (const item of raw) {
    const entry = item as {
      dayOfWeek?: unknown;
      startTime?: unknown;
      endTime?: unknown;
      breaks?: unknown;
    };
    const dayOfWeek = Number(entry.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { ok: false, error: "יום בשבוע חייב להיות בין 0 (ראשון) ל-6 (שבת)" };
    }
    if (seenDays.has(dayOfWeek)) {
      return { ok: false, error: "אותו יום בשבוע מופיע פעמיים בלוח שעות העבודה" };
    }
    seenDays.add(dayOfWeek);
    const start = typeof entry.startTime === "string" ? parseTimeToMinutes(entry.startTime) : null;
    const end = typeof entry.endTime === "string" ? parseTimeToMinutes(entry.endTime) : null;
    if (start === null || end === null || start >= end) {
      return { ok: false, error: "שעות עבודה לא תקינות — שעת התחלה חייבת להיות לפני שעת סיום (HH:MM)" };
    }
    const breaks: Array<{ start: string; end: string }> = [];
    if (entry.breaks !== undefined) {
      if (!Array.isArray(entry.breaks)) {
        return { ok: false, error: "breaks must be an array" };
      }
      for (const rawBreak of entry.breaks) {
        const breakItem = rawBreak as { start?: unknown; end?: unknown };
        const breakStart =
          typeof breakItem.start === "string" ? parseTimeToMinutes(breakItem.start) : null;
        const breakEnd = typeof breakItem.end === "string" ? parseTimeToMinutes(breakItem.end) : null;
        if (breakStart === null || breakEnd === null || breakStart >= breakEnd) {
          return { ok: false, error: "הפסקה לא תקינה — שעת התחלה חייבת להיות לפני שעת סיום (HH:MM)" };
        }
        if (breakStart < start || breakEnd > end) {
          return { ok: false, error: "הפסקה חייבת להיות בתוך שעות העבודה של אותו יום" };
        }
        breaks.push({ start: breakItem.start as string, end: breakItem.end as string });
      }
    }
    entries.push({
      dayOfWeek,
      startTime: entry.startTime as string,
      endTime: entry.endTime as string,
      breaks,
    });
  }
  return { ok: true, entries };
}

/**
 * האם התור בתוך שעות העבודה של העובד (ולא בתוך הפסקה)?
 *
 * לוח ריק = אין הגבלת שעות (עובד שעדיין לא הוגדרו לו שעות לא נחסם).
 * תור שחוצה חצות מקומית נבדק מול היום שבו הוא מתחיל.
 */
export function isWithinEmployeeWorkingHours(params: {
  interval: BookingInterval;
  timeZone: string;
  schedule: WeeklyScheduleEntry[];
}): boolean {
  const { interval, timeZone, schedule } = params;
  if (schedule.length === 0) return true;

  const weekday = localWeekday(interval.start, timeZone);
  const day = schedule.find((entry) => entry.dayOfWeek === weekday);
  if (!day) return false;

  const dayStart = parseTimeToMinutes(day.startTime);
  const dayEnd = parseTimeToMinutes(day.endTime);
  if (dayStart === null || dayEnd === null) return false;

  const startMinutes = localMinutesOfDay(interval.start, timeZone);
  const durationMinutes = Math.round((interval.end.getTime() - interval.start.getTime()) / 60_000);
  const endMinutes = startMinutes + durationMinutes;

  if (startMinutes < dayStart || endMinutes > dayEnd) return false;

  for (const breakItem of day.breaks) {
    const breakStart = parseTimeToMinutes(breakItem.start);
    const breakEnd = parseTimeToMinutes(breakItem.end);
    if (breakStart === null || breakEnd === null) continue;
    if (startMinutes < breakEnd && endMinutes > breakStart) return false;
  }

  return true;
}

/** האם תאריך התור (מקומי) נופל בטווח חופשה של העובד? */
export function isOnVacation(params: {
  start: Date;
  timeZone: string;
  vacations: VacationRange[];
}): boolean {
  if (params.vacations.length === 0) return false;
  const dateKey = localDateKey(params.start, params.timeZone);
  return params.vacations.some(
    (vacation) => dateKey >= vacation.startDate && dateKey <= vacation.endDate
  );
}

export type ExistingBooking = {
  id: string;
  start: Date;
  end: Date;
};

/** חפיפה עם תור קיים של אותו עובד (start < end של השני ולהפך). */
export function findBookingOverlap(
  candidate: BookingInterval,
  existing: ExistingBooking[],
  options?: { excludeId?: string }
): ExistingBooking | null {
  for (const booking of existing) {
    if (options?.excludeId && booking.id === options.excludeId) continue;
    if (candidate.start.getTime() < booking.end.getTime() && candidate.end.getTime() > booking.start.getTime()) {
      return booking;
    }
  }
  return null;
}

export const EMPLOYEE_BOOKING_MESSAGES = {
  outside_working_hours: "השעה מחוץ לשעות העבודה של העובד",
  on_vacation: "העובד בחופשה בתאריך הזה",
  time_conflict: "לעובד כבר יש תור בשעה הזו",
} as const;

/** הכרעת הזמנה מלאה מנתונים שנטענו מראש — ללא תלות ב-DB. */
export function decideEmployeeBooking(params: {
  interval: BookingInterval;
  timeZone: string;
  schedule: WeeklyScheduleEntry[];
  vacations: VacationRange[];
  existingBookings: ExistingBooking[];
  excludeBookingId?: string;
}): EmployeeBookingDecision {
  if (
    !isWithinEmployeeWorkingHours({
      interval: params.interval,
      timeZone: params.timeZone,
      schedule: params.schedule,
    })
  ) {
    return {
      ok: false,
      code: "outside_working_hours",
      message: EMPLOYEE_BOOKING_MESSAGES.outside_working_hours,
    };
  }
  if (isOnVacation({ start: params.interval.start, timeZone: params.timeZone, vacations: params.vacations })) {
    return { ok: false, code: "on_vacation", message: EMPLOYEE_BOOKING_MESSAGES.on_vacation };
  }
  const overlap = findBookingOverlap(params.interval, params.existingBookings, {
    excludeId: params.excludeBookingId,
  });
  if (overlap) {
    return { ok: false, code: "time_conflict", message: EMPLOYEE_BOOKING_MESSAGES.time_conflict };
  }
  return { ok: true };
}
