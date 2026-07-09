import type { ReminderSendInput, ReminderSendResult } from "./types.js";

export interface ReminderProvider {
  providerKey(): string;
  sendReminder(input: ReminderSendInput): Promise<ReminderSendResult>;
}
