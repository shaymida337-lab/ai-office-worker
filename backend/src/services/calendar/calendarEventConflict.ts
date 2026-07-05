import { checkUnifiedSchedulingConflict } from "./schedulingConflict.js";

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
  const result = await checkUnifiedSchedulingConflict({
    organizationId: params.organizationId,
    start: params.startAt,
    end: params.endAt,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
  });

  if (result.hasConflict && result.conflict) {
    return {
      hasConflict: true,
      conflict: {
        id: result.conflict.id,
        source: result.conflict.source,
        clientName: result.conflict.clientName,
        startTime: result.conflict.startTime.toISOString(),
        endTime: result.conflict.endTime.toISOString(),
      },
    };
  }

  return { hasConflict: false };
}
