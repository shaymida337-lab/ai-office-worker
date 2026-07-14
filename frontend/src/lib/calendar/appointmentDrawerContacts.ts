/**
 * חיווט כפתורי הקשר בחלון פרטי תור — מקור אמת אחד לשדות הטלפון/מייל/clientId.
 * השימוש: גם מה-props של התור וגם מ-GET /api/clients/:id (מיזוג).
 */
import {
  buildMailtoUrl,
  buildTelUrl,
  buildWhatsAppUrl,
} from "@/lib/contactActions";

export type AppointmentDrawerContactInput = {
  clientId?: string | null;
  client?: {
    id?: string | null;
    phone?: string | null;
    whatsappNumber?: string | null;
    email?: string | null;
    emailIsPlaceholder?: boolean | null;
  } | null;
  /** תוצאת טעינה משנית מ-/api/clients/:id — דורסת כשמוגדרת */
  fetched?: {
    phone?: string | null;
    whatsappNumber?: string | null;
    email?: string | null;
  } | null;
};

function cleanPhoneRaw(phone: string | null | undefined): string | null {
  const cleaned = (phone ?? "").replace(/^whatsapp:/i, "").trim();
  return cleaned || null;
}

function resolveEmail(
  email: string | null | undefined,
  emailIsPlaceholder?: boolean | null
): string | null {
  if (emailIsPlaceholder) return null;
  const trimmed = email?.trim() || null;
  return trimmed;
}

export type AppointmentDrawerContactActions = {
  clientId: string | null;
  phoneDisplay: string | null;
  whatsappDisplay: string | null;
  emailDisplay: string | null;
  telHref: string | null;
  waHref: string | null;
  mailHref: string | null;
  openClientPath: string | null;
};

/**
 * מאחד שדות קשר משכבות client/appointment/fetched ומחשב href/ניווט.
 * כפתור disabled רק כשה-href/path באמת חסר.
 */
export function resolveAppointmentDrawerContactActions(
  input: AppointmentDrawerContactInput
): AppointmentDrawerContactActions {
  const clientId =
    input.clientId?.trim() || input.client?.id?.trim() || null;

  const embeddedEmail = resolveEmail(input.client?.email, input.client?.emailIsPlaceholder);
  // fetched.email כבר מסונן מ-placeholder בצד הקורא; אם fetched קיים — מעדיפים אותו גם כשריק (null).
  const email =
    input.fetched !== undefined && input.fetched !== null
      ? input.fetched.email?.trim() || null
      : embeddedEmail;

  const rawWhatsapp = cleanPhoneRaw(
    (input.fetched !== undefined && input.fetched !== null
      ? input.fetched.whatsappNumber
      : null) ||
      input.client?.whatsappNumber ||
      null
  );
  const rawPhone =
    cleanPhoneRaw(
      (input.fetched !== undefined && input.fetched !== null ? input.fetched.phone : null) ||
        input.client?.phone ||
        null
    ) || rawWhatsapp;

  const telHref = buildTelUrl(rawPhone);
  const waHref = buildWhatsAppUrl(rawWhatsapp || rawPhone);
  const mailHref = buildMailtoUrl(email);

  return {
    clientId,
    phoneDisplay: rawPhone,
    whatsappDisplay: rawWhatsapp,
    emailDisplay: email,
    telHref,
    waHref,
    mailHref,
    openClientPath: clientId ? `/dashboard/clients/${clientId}` : null,
  };
}
