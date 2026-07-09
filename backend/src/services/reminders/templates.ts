type ReminderTemplateContext = {
  clientName: string;
  businessName: string;
  appointmentDate: string;
  appointmentTime: string;
  service: string;
  staffName: string;
};

type TemplateLocale = "he" | "en";
type TemplateKey = "reminder_24h" | "reminder_same_day";

const TEMPLATE_VERSION = 1;

export function reminderTemplateVersion() {
  return TEMPLATE_VERSION;
}

export function resolveTemplateLocale(locale: string | null | undefined): TemplateLocale {
  return String(locale ?? "").toLowerCase().startsWith("en") ? "en" : "he";
}

export function renderReminderTemplate(input: {
  key: TemplateKey;
  locale: string | null | undefined;
  context: ReminderTemplateContext;
}): { templateKey: TemplateKey; version: number; locale: TemplateLocale; body: string } {
  const locale = resolveTemplateLocale(input.locale);
  const c = input.context;
  if (locale === "en") {
    const body =
      input.key === "reminder_24h"
        ? `Hi ${c.clientName}, reminder from ${c.businessName}: ${c.service} on ${c.appointmentDate} at ${c.appointmentTime}. Reply: Confirm / Decline / Reschedule`
        : `Today reminder from ${c.businessName}: ${c.service} at ${c.appointmentTime}. Reply: Confirm / Decline / Reschedule`;
    return { templateKey: input.key, version: TEMPLATE_VERSION, locale, body };
  }

  const body =
    input.key === "reminder_24h"
      ? `היי ${c.clientName}, תזכורת מ${c.businessName}: ${c.service} בתאריך ${c.appointmentDate} בשעה ${c.appointmentTime}. אפשר לענות: אישור / ביטול / דחייה`
      : `תזכורת להיום מ${c.businessName}: ${c.service} בשעה ${c.appointmentTime}. אפשר לענות: אישור / ביטול / דחייה`;
  return { templateKey: input.key, version: TEMPLATE_VERSION, locale, body };
}
