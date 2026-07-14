/**
 * כרטיס לקוח — helpers טהורים: ראשי תיבות, קישורי חיוג/וואטסאפ,
 * ותצוגת "לא הוזן" במקום null/undefined. קישורי הפעולה מנותבים לשכבת
 * ה-utility המשותפת (contactActions) כדי שההתנהגות תהיה זהה גם בחלון התור.
 */

import {
  buildGoogleMapsUrl,
  buildMailtoUrl,
  buildTelUrl,
  buildWazeUrl,
  buildWhatsAppUrl,
} from "../contactActions";

export const NOT_PROVIDED = "לא הוזן";

export function displayOrFallback(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : NOT_PROVIDED;
}

/** ראשי תיבות לעיגול התמונה: עד שתי אותיות מתחילות המילים. */
export function clientInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2);
  return `${words[0]![0]}${words[1]![0]}`;
}

/** המספר נשמר לעיתים כ-"whatsapp:+972..." — בתצוגה ובקישורים מנקים את הקידומת. */
function cleanPhoneRaw(phone: string | null | undefined): string | null {
  const cleaned = (phone ?? "").replace(/^whatsapp:/i, "").trim();
  return cleaned || null;
}

export function displayPhone(phone: string | null | undefined): string {
  return cleanPhoneRaw(phone) || NOT_PROVIDED;
}

/** קישור חיוג — tel: (נרמול משותף: 05.../+972.../בינלאומי/00). */
export function telHref(phone: string | null | undefined): string | null {
  return buildTelUrl(cleanPhoneRaw(phone));
}

/** קישור וואטסאפ — wa.me עם ספרות בלבד בפורמט בינלאומי (נרמול משותף לישראל). */
export function whatsappHref(phone: string | null | undefined): string | null {
  return buildWhatsAppUrl(cleanPhoneRaw(phone));
}

/** קישור mailto: לפתיחת תוכנת המייל; null אם אין אימייל תקין. */
export function mailtoHref(email: string | null | undefined): string | null {
  return buildMailtoUrl(email);
}

/**
 * קישור ניווט: Waze קודם (universal URL), ואם אין כתובת — null. Google Maps
 * זמין כ-fallback דרך {@link buildGoogleMapsUrl}.
 */
export function mapsHref(address: string | null | undefined): string | null {
  return buildWazeUrl(address) ?? buildGoogleMapsUrl(address);
}

export type NextAppointmentView = {
  dateLabel: string;
  timeLabel: string;
  serviceLabel: string;
  employeeLabel: string;
};

/** תצוגת התור הבא בעברית; שדות חסרים מוצגים "לא הוזן"/"בעל העסק". */
export function formatNextAppointment(
  appointment: {
    startTime: string;
    serviceName: string | null;
    employeeName: string | null;
  },
  timeZone: string
): NextAppointmentView {
  const start = new Date(appointment.startTime);
  return {
    dateLabel: start.toLocaleDateString("he-IL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone,
    }),
    timeLabel: start.toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }),
    serviceLabel: displayOrFallback(appointment.serviceName),
    employeeLabel: appointment.employeeName?.trim() ? appointment.employeeName : "בעל העסק",
  };
}

export type ClientAppointmentListRow = {
  id: string;
  startTime: string;
  status: string;
  serviceName: string | null;
  employeeName: string | null;
  price?: number | null;
};

/**
 * לשונית פגישות: הפגישה העתידית הקרובה ראשונה, ושאר התורים מהחדש לישן.
 * מבוטל לא נחשב "הפגישה הבאה".
 */
export function orderClientAppointmentsForTab<T extends ClientAppointmentListRow>(
  appointments: T[],
  nowMs: number = Date.now()
): { rows: T[]; nextAppointmentId: string | null } {
  const next = appointments
    .filter((row) => row.status !== "cancelled" && new Date(row.startTime).getTime() >= nowMs)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  const nextAppointmentId = next?.id ?? null;
  const rest = appointments
    .filter((row) => row.id !== nextAppointmentId)
    .slice()
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  const rows = nextAppointmentId
    ? [appointments.find((row) => row.id === nextAppointmentId)!, ...rest]
    : rest;
  return { rows, nextAppointmentId };
}

/** מחיר שירות לתצוגה בכרטיס; אין מחיר → "לא הוזן". */
export function formatAppointmentPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return NOT_PROVIDED;
  return `₪${price.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;
}
