type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

export type LocalTimeParts = LocalDateParts & {
  hour: number;
  minute: number;
};

const HEBREW_WEEKDAY_TARGETS: Array<{ day: number; patterns: string[] }> = [
  { day: 0, patterns: ["יום ראשון", "ראשון"] },
  { day: 1, patterns: ["יום שני", "שני"] },
  { day: 2, patterns: ["יום שלישי", "שלישי"] },
  { day: 3, patterns: ["יום רביעי", "רביעי"] },
  { day: 4, patterns: ["יום חמישי", "חמישי"] },
  { day: 5, patterns: ["יום שישי", "שישי"] },
  { day: 6, patterns: ["יום שבת", "שבת"] },
];

export function resolveSlotTime(params: {
  dayReference?: string;
  time?: string;
  explicitStartTime?: string;
  startTime?: string;
  timeZone: string;
  now?: Date;
}): Date | null {
  const explicit = params.explicitStartTime?.trim() || params.startTime?.trim();
  if (explicit) {
    const parsedExplicit = parseExplicitStartTime(explicit, params.timeZone);
    if (parsedExplicit) return parsedExplicit;
  }

  const dayReference = params.dayReference?.trim();
  const time = params.time?.trim();
  if (!dayReference || !time) return null;

  const timeZone = params.timeZone.trim() || "Asia/Jerusalem";
  const now = params.now ?? new Date();
  const localParts = resolveDayReference(dayReference, now, timeZone);
  const parsedTime = parseAppointmentTime(time);
  if (!localParts || !parsedTime) return null;

  return wallClockToDate(
    localParts.year,
    localParts.month,
    localParts.day,
    parsedTime.hours,
    parsedTime.minutes,
    timeZone
  );
}

/** @deprecated Use resolveSlotTime — kept for existing appointment/Natalie callers */
export function resolveAppointmentDateTime(params: {
  dayReference?: string;
  time?: string;
  explicitStartTime?: string;
  timeZone: string;
  now?: Date;
}): Date | null {
  return resolveSlotTime(params);
}

export function getDayBounds(date: Date, timeZone: string): { start: Date; end: Date } {
  const parts = getLocalDateParts(date, timeZone);
  const start = wallClockToDate(parts.year, parts.month, parts.day, 0, 0, timeZone);
  if (!start) {
    throw new Error("Failed to resolve day bounds");
  }
  const nextDay = addCalendarDays(parts, 1);
  const end = wallClockToDate(nextDay.year, nextDay.month, nextDay.day, 0, 0, timeZone);
  if (!end) {
    throw new Error("Failed to resolve day bounds");
  }
  return { start, end };
}

export function getWeekBounds(anchor: Date, timeZone: string): { start: Date; end: Date } {
  const parts = getLocalDateParts(anchor, timeZone);
  const weekday = getWeekdayInTimezone(anchor, timeZone);
  const weekStartParts = addCalendarDays(parts, -weekday);
  const start = wallClockToDate(weekStartParts.year, weekStartParts.month, weekStartParts.day, 0, 0, timeZone);
  if (!start) {
    throw new Error("Failed to resolve week bounds");
  }
  const weekEndParts = addCalendarDays(weekStartParts, 7);
  const end = wallClockToDate(weekEndParts.year, weekEndParts.month, weekEndParts.day, 0, 0, timeZone);
  if (!end) {
    throw new Error("Failed to resolve week bounds");
  }
  return { start, end };
}

export function formatSlotLabel(start: Date, timeZone: string, now: Date = new Date()): string {
  const startDay = getLocalDateParts(start, timeZone);
  const today = getLocalDateParts(now, timeZone);
  const tomorrow = addCalendarDays(today, 1);

  const timeLabel = new Intl.DateTimeFormat("he-IL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(start);

  let dayLabel: string;
  if (
    startDay.year === today.year &&
    startDay.month === today.month &&
    startDay.day === today.day
  ) {
    dayLabel = "היום";
  } else if (
    startDay.year === tomorrow.year &&
    startDay.month === tomorrow.month &&
    startDay.day === tomorrow.day
  ) {
    dayLabel = "מחר";
  } else {
    dayLabel = new Intl.DateTimeFormat("he-IL", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(start);
  }

  return `${dayLabel}, ${timeLabel}`;
}

/** e.g. "10:00 מחר" — used when repeating the user's requested slot in availability replies. */
export function formatRequestedSlotLabel(start: Date, timeZone: string, now: Date = new Date()): string {
  const startDay = getLocalDateParts(start, timeZone);
  const today = getLocalDateParts(now, timeZone);
  const tomorrow = addCalendarDays(today, 1);

  const timeLabel = new Intl.DateTimeFormat("he-IL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(start);

  let dayLabel: string;
  if (
    startDay.year === today.year &&
    startDay.month === today.month &&
    startDay.day === today.day
  ) {
    dayLabel = "היום";
  } else if (
    startDay.year === tomorrow.year &&
    startDay.month === tomorrow.month &&
    startDay.day === tomorrow.day
  ) {
    dayLabel = "מחר";
  } else {
    dayLabel = new Intl.DateTimeFormat("he-IL", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(start);
  }

  return `${timeLabel} ${dayLabel}`;
}

export function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function getLocalTimeParts(date: Date, timeZone: string): LocalTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function addCalendarDays(parts: LocalDateParts, daysToAdd: number): LocalDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function wallClockToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date | null {
  if (!isValidCalendarDate(year, month, day)) return null;

  const localDateTime = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  const provisional = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = getTimezoneOffsetForDate(provisional, timeZone);
  const parsed = new Date(`${localDateTime}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * מחרוזת עם Z/offset מפורש נשמרת כמו שהיא (new Date, תאימות לאחור מלאה);
 * מחרוזת נאיבית בפורמט ISO מתפרשת כשעון-קיר ב-timeZone הנתון (לא בשל השרת).
 */
export function parseExplicitStartTime(value: string, timeZone: string): Date | null {
  if (/[zZ]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) {
    return wallClockToDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      Number(isoMatch[4]),
      Number(isoMatch[5]),
      timeZone
    );
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveDayReference(dayReference: string, now: Date, timeZone: string): LocalDateParts | null {
  const normalized = dayReference.trim().replace(/\s+/g, " ");
  const today = getLocalDateParts(now, timeZone);

  if (/^היום$/u.test(normalized)) {
    return today;
  }
  if (/^מחר$/u.test(normalized)) {
    return addCalendarDays(today, 1);
  }
  if (/^מחרתיים$/u.test(normalized)) {
    return addCalendarDays(today, 2);
  }

  for (const weekday of HEBREW_WEEKDAY_TARGETS) {
    if (weekday.patterns.some((pattern) => normalized.includes(pattern))) {
      const currentWeekday = getWeekdayInTimezone(now, timeZone);
      const daysToAdd =
        currentWeekday === weekday.day ? 7 : ((weekday.day - currentWeekday + 7) % 7) || 7;
      return addCalendarDays(today, daysToAdd);
    }
  }

  const explicitDate = parseExplicitCalendarDate(normalized, today.year);
  if (explicitDate) return explicitDate;

  return null;
}

function parseExplicitCalendarDate(value: string, defaultYear: number): LocalDateParts | null {
  const match = value.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : defaultYear;
  if (year < 100) year += 2000;

  if (!isValidCalendarDate(year, month, day)) return null;
  return { year, month, day };
}

function parseAppointmentTime(value: string): { hours: number; minutes: number } | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function getWeekdayInTimezone(date: Date, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

function getTimezoneOffsetForDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const getNumber = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtcMs = Date.UTC(
    getNumber("year"),
    getNumber("month") - 1,
    getNumber("day"),
    getNumber("hour"),
    getNumber("minute"),
    getNumber("second")
  );
  const offsetMinutes = Math.round((asUtcMs - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
