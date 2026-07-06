export const DEFAULT_ORG_TIMEZONE = "Asia/Jerusalem";

/** ערך לשדה input[type=date] (YYYY-MM-DD) לפי הרגע הנתון ב-timezone הארגון. */
export function dateInputValueInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** ערך לשדה input[type=time] (HH:mm, שעון 24) לפי הרגע הנתון ב-timezone הארגון. */
export function timeInputValueInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
