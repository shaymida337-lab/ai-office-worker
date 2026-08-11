/**
 * גבול שפיות אחיד לתאריכים עסקיים (F4) — כעת עם עומק היסטורי דינמי.
 *
 * תאריך מסמך סביר חייב להיות:
 *   • לא רחוק מדי בעבר — עד `maxPastYears` שנים אחורה (1–5, ברירת מחדל 2,
 *     נשלט מהגדרת ה-historicalScanYears של הטננט בפיצ'ר הסריקה ההיסטורית).
 *   • לא רחוק בעתיד — עד שנה קדימה בלבד (תאריך מעבר לכך נחשב לא תקין/מנוחש).
 *
 * אותו כלל משותף לכל מסלולי הכניסה: Gmail, WhatsApp, מצלמה/ידני, וסורק הלקוח.
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** ערכי עומק סריקה חוקיים (שנים אחורה) עבור הסריקה ההיסטורית הראשונית. */
export const HISTORICAL_SCAN_YEARS_VALUES = [1, 2, 3, 4, 5] as const;
export type HistoricalScanYears = (typeof HISTORICAL_SCAN_YEARS_VALUES)[number];
export const DEFAULT_HISTORICAL_SCAN_YEARS: HistoricalScanYears = 2;

/** מנרמל קלט כלשהו לערך עומק חוקי (1–5); כל דבר לא תקין נופל לברירת המחדל. */
export function clampHistoricalScanYears(value: unknown): HistoricalScanYears {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) {
    return numeric as HistoricalScanYears;
  }
  return DEFAULT_HISTORICAL_SCAN_YEARS;
}

/** העתיד תמיד חסום לשנה אחת קדימה, ללא תלות בעומק ההיסטורי שנבחר. */
export const BUSINESS_DATE_FUTURE_WINDOW_MS = 1 * YEAR_MS;
/** נשמר לתאימות לאחור: חלון העבר של ברירת המחדל. */
export const BUSINESS_DATE_WINDOW_MS = DEFAULT_HISTORICAL_SCAN_YEARS * YEAR_MS;

export function isWithinBusinessDateWindow(
  date: Date,
  nowMs: number = Date.now(),
  maxPastYears: number = DEFAULT_HISTORICAL_SCAN_YEARS
): boolean {
  const time = date.getTime();
  if (!Number.isFinite(time)) return false;
  const pastWindowMs = clampHistoricalScanYears(maxPastYears) * YEAR_MS;
  return time >= nowMs - pastWindowMs && time <= nowMs + BUSINESS_DATE_FUTURE_WINDOW_MS;
}

/**
 * מפרסר ומחיל את גבול התאריכים; ערך חסר/לא-תקין/מחוץ לטווח מחזיר את ה-fallback.
 * `maxPastYears` מרחיב את חלון העבר (ברירת מחדל 2 שנים).
 */
export function normalizeBusinessDate(
  value: string | Date | null | undefined,
  fallback: Date | null,
  maxPastYears: number = DEFAULT_HISTORICAL_SCAN_YEARS
): Date | null {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  if (!isWithinBusinessDateWindow(date, Date.now(), maxPastYears)) return fallback;
  return date;
}

/**
 * גרסת מחרוזת: מחזירה את המחרוזת המקורית אם התאריך בטווח, אחרת null.
 * נוחה למסלולים שמעבירים תאריכים כמחרוזות (WhatsApp analysis, extractor).
 * `maxPastYears` מרחיב את חלון העבר בהתאם לעומק הסריקה של הטננט.
 */
export function clampBusinessDateString(
  value: string | null | undefined,
  maxPastYears: number = DEFAULT_HISTORICAL_SCAN_YEARS
): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return isWithinBusinessDateWindow(date, Date.now(), maxPastYears) ? value : null;
}
