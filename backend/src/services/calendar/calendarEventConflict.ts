import { checkConflict } from "./engine.js";
import { loadCombinedBusyBlocks } from "./calendarEventBlocks.js";

export type CalendarEventConflictResult = {
  hasConflict: boolean;
  conflict?: {
    id: string;
    source: string;
    clientName?: string;
    startTime: string;
    endTime: string;
  };
};

export async function checkCalendarEventConflict(params: {
  organizationId: string;
  startAt: Date;
  endAt: Date;
  excludeCalendarEventId?: string;
  assignedUserId?: string | null;
}): Promise<CalendarEventConflictResult> {
  const range = { start: params.startAt, end: params.endAt };
  const busyBlocks = await loadCombinedBusyBlocks(params.organizationId, range, {
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
  });

  const result = checkConflict(range, busyBlocks, {
    excludeId: params.excludeCalendarEventId,
    allowBackToBack: true,
  });

  if (!result.available && result.conflict) {
    return {
      hasConflict: true,
      conflict: {
        id: result.conflict.id,
        source: result.conflict.source,
        clientName: result.conflict.clientName,
        startTime: result.conflict.start.toISOString(),
        endTime: result.conflict.end.toISOString(),
      },
    };
  }

  return { hasConflict: false };
}
