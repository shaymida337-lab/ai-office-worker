/**
 * Pure copy helper for Natalie book confirm feedback.
 * Keeps pendingApproval honest: never claim “התור נקבע” when queued.
 */

export function buildBookAppointmentActionFeedback(input: {
  clientName: string;
  whenLabel: string;
  pendingApproval?: boolean;
  message?: string | null;
}): string {
  const pending = input.pendingApproval === true;
  const apiMessage = input.message?.trim();
  if (pending) {
    return apiMessage || `שלחתי לאישור את התור ל${input.clientName} ב${input.whenLabel}`;
  }
  return apiMessage || `✓ התור נקבע ל${input.clientName} ב${input.whenLabel}`;
}
