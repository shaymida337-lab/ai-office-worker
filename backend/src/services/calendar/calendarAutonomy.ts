import { DEFAULT_CALENDAR_AUTONOMY_JSON } from "./enums.js";

export type CalendarAutonomySettings = {
  autoConfirmWhenFullyReady: boolean;
  autoSendFollowUp: boolean;
  autoSyncGoogleOnConfirm: boolean;
  autoCreateFollowUpTask: boolean;
};

export function parseCalendarAutonomyJson(raw: unknown): CalendarAutonomySettings {
  const defaults = DEFAULT_CALENDAR_AUTONOMY_JSON.calendarAutonomy;
  if (!raw || typeof raw !== "object") {
    return { ...defaults };
  }

  const root = raw as Record<string, unknown>;
  const autonomy =
    root.calendarAutonomy && typeof root.calendarAutonomy === "object"
      ? (root.calendarAutonomy as Record<string, unknown>)
      : root;

  return {
    autoConfirmWhenFullyReady: autonomy.autoConfirmWhenFullyReady === true,
    autoSendFollowUp: autonomy.autoSendFollowUp === true,
    autoSyncGoogleOnConfirm: autonomy.autoSyncGoogleOnConfirm !== false,
    autoCreateFollowUpTask: autonomy.autoCreateFollowUpTask !== false,
  };
}
