/**
 * שכבת utility אחת לכל פעולות הקשר והניווט — משמשת גם את חלון פרטי התור
 * וגם את כרטיס הלקוח, כדי שהתנהגות "התקשר / WhatsApp / מייל / ניווט" תהיה
 * זהה בכל מקום. הנרמול הוא לצורך הקישור בלבד; המספר במסד הנתונים לא משתנה.
 */

const MIN_PHONE_DIGITS = 7;

/** תקינות אימייל בסיסית; placeholder/ריק/לא-תקין אינם אימייל אמיתי. */
export function isValidEmail(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

type ParsedPhone = { plus: boolean; digits: string } | null;

/** ניקוי רווחים/מקפים/סוגריים; טיפול ב-00 כקידומת בינלאומית. */
function parsePhone(raw: string | null | undefined): ParsedPhone {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2);
    plus = true;
  }
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return { plus, digits };
}

/**
 * טלפון ל-tel: — פורמט E.164 (עם +). ישראלי שמתחיל ב-0 → +972; מספר עם +
 * או 00 נשמר עם קידומת המדינה; כל השאר מקבל + לפני הספרות.
 */
export function normalizePhoneForTel(raw: string | null | undefined): string | null {
  const parsed = parsePhone(raw);
  if (!parsed) return null;
  const { plus, digits } = parsed;
  if (plus) return `+${digits}`;
  if (digits.startsWith("0")) {
    const local = digits.replace(/^0+/, "");
    return local.length >= 8 ? `+972${local}` : null;
  }
  return `+${digits}`;
}

/**
 * טלפון ל-wa.me — ספרות בלבד, בינלאומי ללא +. ישראלי "05..." → "9725...";
 * "+972..." / "00972..." → "972..."; בינלאומי נשמר עם קידומת המדינה.
 */
export function normalizePhoneForWhatsApp(raw: string | null | undefined): string | null {
  const parsed = parsePhone(raw);
  if (!parsed) return null;
  const { plus, digits } = parsed;
  if (plus) return digits;
  if (digits.startsWith("0")) {
    const local = digits.replace(/^0+/, "");
    return local.length >= 8 ? `972${local}` : null;
  }
  return digits;
}

/** להסיר רווחים מיותרים מכתובת; ריק אינו כתובת אמיתית. */
function cleanAddress(address: string | null | undefined): string | null {
  const trimmed = address?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

export function buildTelUrl(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneForTel(raw);
  return normalized ? `tel:${normalized}` : null;
}

export function buildWhatsAppUrl(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneForWhatsApp(raw);
  return normalized ? `https://wa.me/${normalized}` : null;
}

export function buildMailtoUrl(email: string | null | undefined): string | null {
  return isValidEmail(email) ? `mailto:${email!.trim()}` : null;
}

/**
 * ניווט Waze — ה-universal URL פותח את אפליקציית Waze אם מותקנת, אחרת את
 * Waze Web (fallback בטוח, בלי async לפני הפתיחה).
 */
export function buildWazeUrl(address: string | null | undefined): string | null {
  const cleaned = cleanAddress(address);
  return cleaned ? `https://www.waze.com/ul?q=${encodeURIComponent(cleaned)}&navigate=yes` : null;
}

/** fallback ניווט: Google Maps universal URL. */
export function buildGoogleMapsUrl(address: string | null | undefined): string | null {
  const cleaned = cleanAddress(address);
  return cleaned ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleaned)}` : null;
}
