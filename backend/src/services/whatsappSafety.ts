const WHATSAPP_DEBUG_PII = process.env.WHATSAPP_DEBUG_PII === "true";

export const WHATSAPP_UNMAPPED_SENDER_MESSAGE =
  "המספר הזה עדיין לא מחובר לעסק במערכת. חבר את WhatsApp בהגדרות העסק ונסה שוב.";

export const WHATSAPP_MEDIA_DOWNLOAD_FAILED_MESSAGE =
  "קיבלתי את הקובץ, אבל הייתה תקלה בשמירה או חילוץ הנתונים. נסה לשלוח שוב בעוד רגע.";

export const WHATSAPP_GENERIC_ERROR_MESSAGE =
  "תודה על ההודעה. הייתה תקלה רגעית, נסה שוב בעוד דקה.";

export function isWhatsAppPiiDebugEnabled() {
  return WHATSAPP_DEBUG_PII;
}

export function maskWhatsAppPhoneForLog(phone: string | null | undefined): string {
  if (!phone?.trim()) return "unknown";
  if (WHATSAPP_DEBUG_PII) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

export function maskSupplierForLog(supplier: string | null | undefined): string {
  const value = supplier?.trim() ?? "";
  if (!value) return "unknown";
  if (WHATSAPP_DEBUG_PII) return value;
  if (value.length <= 2) return "**";
  return `${value.slice(0, 2)}***`;
}

export function maskBodyPreviewForLog(body: string | null | undefined, max = 80): string | null {
  if (!body?.trim()) return null;
  if (WHATSAPP_DEBUG_PII) return body.slice(0, max);
  return `[redacted:${body.trim().length}chars]`;
}

export function buildWhatsAppWebhookLogContext(input: {
  sid: string;
  from: string;
  to: string;
  mediaCount: number;
  body?: string;
  extra?: Record<string, unknown>;
}) {
  return {
    sid: input.sid,
    from: maskWhatsAppPhoneForLog(input.from),
    to: maskWhatsAppPhoneForLog(input.to),
    mediaCount: input.mediaCount,
    bodyPreview: maskBodyPreviewForLog(input.body ?? ""),
    ...input.extra,
  };
}
