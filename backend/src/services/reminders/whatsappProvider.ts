import { sendWhatsAppToPhone } from "../whatsapp.js";
import type { ReminderProvider } from "./provider.js";
import type { ReminderSendInput, ReminderSendResult } from "./types.js";

export class WhatsAppReminderProvider implements ReminderProvider {
  providerKey(): string {
    return "whatsapp";
  }

  async sendReminder(input: ReminderSendInput): Promise<ReminderSendResult> {
    try {
      const result = await sendWhatsAppToPhone(input.organizationId, input.clientPhone, input.body, undefined, true);
      if (!result.sent) {
        return {
          ok: false,
          provider: this.providerKey(),
          retryable: true,
          errorCode: "send_failed",
          errorMessage: result.reason ?? "Failed to send WhatsApp reminder",
        };
      }
      return {
        ok: true,
        provider: this.providerKey(),
        providerMessageId: result.sid ?? null,
        providerStatus: "sent",
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.providerKey(),
        retryable: true,
        errorCode: "exception",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
