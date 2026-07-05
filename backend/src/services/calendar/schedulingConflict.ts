import { appointmentEnd, checkConflict } from "./engine.js";
import { loadCombinedBusyBlocks } from "./calendarEventBlocks.js";
import type { BusyBlock, TimeInterval } from "./types.js";

export type UnifiedSchedulingConflict = {
  hasConflict: boolean;
  conflict?: {
    id: string;
    source: BusyBlock["source"];
    clientName?: string;
    serviceName?: string;
    startTime: Date;
    endTime: Date;
    durationMinutes?: number;
  };
};

/**
 * Authoritative scheduling conflict check across legacy appointments and calendar engine events.
 */
export async function checkUnifiedSchedulingConflict(params: {
  organizationId: string;
  start: Date;
  end: Date;
  excludeAppointmentId?: string;
  excludeCalendarEventId?: string;
  assignedUserId?: string | null;
  allowBackToBack?: boolean;
}): Promise<UnifiedSchedulingConflict> {
  const range: TimeInterval = { start: params.start, end: params.end };
  const busyBlocks = await loadCombinedBusyBlocks(params.organizationId, range, {
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
  });

  const excludeId = params.excludeCalendarEventId ?? params.excludeAppointmentId;
  const result = checkConflict(range, busyBlocks, {
    excludeId,
    allowBackToBack: params.allowBackToBack ?? true,
  });

  if (!result.available && result.conflict) {
    const block = result.conflict;
    return {
      hasConflict: true,
      conflict: {
        id: block.id,
        source: block.source,
        clientName: block.clientName,
        serviceName: block.serviceName,
        startTime: block.start,
        endTime: block.end,
        durationMinutes:
          block.durationMinutes ??
          Math.max(1, Math.round((block.end.getTime() - block.start.getTime()) / 60_000)),
      },
    };
  }

  return { hasConflict: false };
}

export async function checkUnifiedSchedulingConflictByDuration(params: {
  organizationId: string;
  startTime: Date;
  durationMinutes: number;
  excludeAppointmentId?: string;
  excludeCalendarEventId?: string;
  assignedUserId?: string | null;
  allowBackToBack?: boolean;
}): Promise<UnifiedSchedulingConflict> {
  return checkUnifiedSchedulingConflict({
    organizationId: params.organizationId,
    start: params.startTime,
    end: appointmentEnd(params.startTime, params.durationMinutes),
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
    allowBackToBack: params.allowBackToBack,
  });
}
