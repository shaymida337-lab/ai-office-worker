import type { NormalizedReminderReply } from "./types.js";

const BUTTON_CONFIRM = /^(confirm|confirmed|אישור|מאשר|מאשרת|כן)$/i;
const BUTTON_DECLINE = /^(decline|declined|cancel|ביטול|לא)$/i;
const BUTTON_RESCHEDULE = /^(reschedule|reschedule_request|דחייה|לדחות|לתאם מחדש)$/i;

const FREE_TEXT_CONFIRM = /(מאשר|מאשרת|אגיע|אגיע|confirmed|i confirm|yes)/i;
const FREE_TEXT_DECLINE = /(מבטל|מבטלת|לא מגיע|לא אגיע|can't|cannot|decline|cancel)/i;
const FREE_TEXT_RESCHEDULE = /(לדחות|לתאם מחדש|מועד אחר|reschedule|another time|different time)/i;

export function interpretReminderReply(input: { text?: string | null; buttonPayload?: string | null }): NormalizedReminderReply {
  const payload = input.buttonPayload?.trim();
  if (payload) {
    if (BUTTON_CONFIRM.test(payload)) return "confirm";
    if (BUTTON_DECLINE.test(payload)) return "decline";
    if (BUTTON_RESCHEDULE.test(payload)) return "reschedule_request";
  }

  const text = input.text?.trim();
  if (!text) return "unknown";
  if (FREE_TEXT_CONFIRM.test(text)) return "confirm";
  if (FREE_TEXT_DECLINE.test(text)) return "decline";
  if (FREE_TEXT_RESCHEDULE.test(text)) return "reschedule_request";
  return "unknown";
}
