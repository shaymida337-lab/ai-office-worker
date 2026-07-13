/**
 * כרטיס לקוח — helpers טהורים: ראשי תיבות, קישורי חיוג/וואטסאפ,
 * ותצוגת "לא הוזן" במקום null/undefined.
 */

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

/** המספר נשמר לעיתים כ-"whatsapp:+972..." — בתצוגה מציגים מספר נקי. */
export function displayPhone(phone: string | null | undefined): string {
  const cleaned = (phone ?? "").replace(/^whatsapp:/i, "").trim();
  return cleaned || NOT_PROVIDED;
}

function digitsOnly(value: string): string {
  return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

/** קישור חיוג — tel: עם המספר כפי שהוא (בניקוי תווים). */
export function telHref(phone: string | null | undefined): string | null {
  const cleaned = phone ? digitsOnly(phone.trim()) : "";
  return cleaned.length >= 7 ? `tel:${cleaned}` : null;
}

/**
 * קישור וואטסאפ — wa.me דורש פורמט בינלאומי בלי + ובלי אפס מוביל:
 * "050-1234567" → 972501234567; "+972501234567" → 972501234567.
 */
export function whatsappHref(phone: string | null | undefined): string | null {
  const cleaned = phone ? digitsOnly(phone.trim()) : "";
  if (!cleaned || cleaned.replace(/\D/g, "").length < 7) return null;
  let international = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  if (international.startsWith("0")) {
    international = `972${international.slice(1)}`;
  }
  return `https://wa.me/${international}`;
}

/** קישור mailto: לפתיחת תוכנת המייל; null אם אין אימייל. */
export function mailtoHref(email: string | null | undefined): string | null {
  const cleaned = email?.trim();
  if (!cleaned || !cleaned.includes("@")) return null;
  return `mailto:${cleaned}`;
}

/**
 * קישור ניווט ל-Google Maps (universal URL): במובייל נפתחת אפליקציית
 * המפות/וייז ובדסקטופ אתר המפות. null אם אין כתובת.
 */
export function mapsHref(address: string | null | undefined): string | null {
  const cleaned = address?.trim();
  if (!cleaned) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleaned)}`;
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
