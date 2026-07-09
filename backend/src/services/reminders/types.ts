export const ATTENDANCE_STATES = [
  "scheduled",
  "reminder_pending",
  "reminder_sent",
  "confirmed",
  "declined",
  "reschedule_requested",
  "no_response",
  "arrived",
  "no_show",
  "cancelled",
] as const;

export type AttendanceState = (typeof ATTENDANCE_STATES)[number];

export type NormalizedReminderReply = "confirm" | "decline" | "reschedule_request" | "unknown";

export type ReminderSendInput = {
  organizationId: string;
  appointmentId: string;
  clientPhone: string;
  locale: string;
  body: string;
  idempotencyKey: string;
};

export type ReminderSendResult =
  | { ok: true; provider: string; providerMessageId: string | null; providerStatus: string | null }
  | { ok: false; provider: string; retryable: boolean; errorCode: string; errorMessage: string };
