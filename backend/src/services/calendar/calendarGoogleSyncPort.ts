import type { CalendarEventActor } from "./calendarEventMutations.js";
import { incrementCalendarEnginePendingSyncJobs } from "./calendarEngineHealth.js";

export type CalendarGoogleSyncAction = "create" | "update" | "delete";

export type CalendarGoogleSyncRequest = {
  organizationId: string;
  calendarEventId: string;
  action: CalendarGoogleSyncAction;
  actor: CalendarEventActor;
  correlationId?: string;
};

export type CalendarGoogleSyncResult = {
  status: "skipped" | "queued" | "synced" | "failed";
  googleEventId?: string | null;
  message?: string;
};

/**
 * Port for Google Calendar sync — Phase B provides interface only.
 * Production sync remains disabled; default implementation is a no-op.
 */
export interface CalendarGoogleSyncPort {
  scheduleSync(request: CalendarGoogleSyncRequest): Promise<CalendarGoogleSyncResult>;
}

export class NoOpCalendarGoogleSyncPort implements CalendarGoogleSyncPort {
  async scheduleSync(_request: CalendarGoogleSyncRequest): Promise<CalendarGoogleSyncResult> {
    return { status: "skipped", message: "Google sync port not enabled (Phase B isolation)" };
  }
}

let activeGoogleSyncPort: CalendarGoogleSyncPort = new NoOpCalendarGoogleSyncPort();

export function getCalendarGoogleSyncPort(): CalendarGoogleSyncPort {
  return activeGoogleSyncPort;
}

export function setCalendarGoogleSyncPort(port: CalendarGoogleSyncPort): void {
  activeGoogleSyncPort = port;
}

export function resetCalendarGoogleSyncPortForTests(): void {
  activeGoogleSyncPort = new NoOpCalendarGoogleSyncPort();
}

export async function scheduleCalendarGoogleSyncViaPort(
  request: CalendarGoogleSyncRequest
): Promise<CalendarGoogleSyncResult> {
  incrementCalendarEnginePendingSyncJobs(1);
  try {
    return await getCalendarGoogleSyncPort().scheduleSync(request);
  } finally {
    incrementCalendarEnginePendingSyncJobs(-1);
  }
}
