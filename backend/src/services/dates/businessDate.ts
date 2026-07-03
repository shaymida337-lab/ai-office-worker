/**
 * גבול שפיות אחיד לתאריכים עסקיים (F4).
 *
 * תאריך מסמך סביר חייב להיות בטווח של ±2 שנים מהיום — אותו כלל שהיה קיים
 * רק במסלול Gmail (normalizeBusinessDate המקומי ב-gmail-sync) ועכשיו משותף
 * לכל מסלולי הכניסה: Gmail, WhatsApp, מצלמה/ידני.
 */

export const BUSINESS_DATE_WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000;

export function isWithinBusinessDateWindow(date: Date, nowMs: number = Date.now()): boolean {
  const time = date.getTime();
  if (!Number.isFinite(time)) return false;
  return time >= nowMs - BUSINESS_DATE_WINDOW_MS && time <= nowMs + BUSINESS_DATE_WINDOW_MS;
}

/**
 * מפרסר ומחיל את גבול ±2 השנים; ערך חסר/לא-תקין/מחוץ לטווח מחזיר את ה-fallback.
 * (התנהגות זהה לפונקציה שהייתה ב-gmail-sync.)
 */
export function normalizeBusinessDate(
  value: string | Date | null | undefined,
  fallback: Date | null
): Date | null {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  if (!isWithinBusinessDateWindow(date)) return fallback;
  return date;
}

/**
 * גרסת מחרוזת: מחזירה את המחרוזת המקורית אם התאריך בטווח, אחרת null.
 * נוחה למסלולים שמעבירים תאריכים כמחרוזות (WhatsApp analysis, extractor).
 */
export function clampBusinessDateString(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return isWithinBusinessDateWindow(date) ? value : null;
}
