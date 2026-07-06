import { findAvailableSlotsForOrganization } from "./availability.js";
import { checkUnifiedSchedulingConflict } from "./schedulingConflict.js";
import type {
  CalendarConflictDetail,
  CalendarConflictResult,
  CalendarConflictType,
  CalendarEngineEventInput,
} from "./calendarEngineTypes.js";

export type DetectConflictsParams = {
  organizationId: string;
  input: Pick<CalendarEngineEventInput, "startAt" | "endAt" | "clientId" | "assignedUserId" | "serviceId">;
  excludeCalendarEventId?: string;
  excludeAppointmentId?: string;
  suggestionLimit?: number;
  now?: Date;
};

function mapConflictType(source: string): CalendarConflictType {
  if (source === "appointment" || source === "calendar_event") return "overlapping_meeting";
  return "busy_resource";
}

export async function detectConflicts(params: DetectConflictsParams): Promise<CalendarConflictResult> {
  const { organizationId, input } = params;
  const conflicts: CalendarConflictDetail[] = [];

  const unified = await checkUnifiedSchedulingConflict({
    organizationId,
    start: input.startAt,
    end: input.endAt,
    excludeCalendarEventId: params.excludeCalendarEventId,
    excludeAppointmentId: params.excludeAppointmentId,
    assignedUserId: input.assignedUserId,
  });

  if (unified.hasConflict && unified.conflict) {
    conflicts.push({
      type: mapConflictType(unified.conflict.source),
      message: "Requested time overlaps an existing booking",
      conflictId: unified.conflict.id,
      conflictSource: unified.conflict.source,
      clientName: unified.conflict.clientName,
      startTime: unified.conflict.startTime.toISOString(),
      endTime: unified.conflict.endTime.toISOString(),
    });
  }

  if (input.clientId) {
    const duplicate = await checkDuplicateMeeting({
      organizationId,
      clientId: input.clientId,
      startAt: input.startAt,
      endAt: input.endAt,
      excludeCalendarEventId: params.excludeCalendarEventId,
    });
    if (duplicate) {
      conflicts.push({
        type: "duplicate_meeting",
        message: "Client already has a meeting at this time",
        conflictId: duplicate.id,
        conflictSource: duplicate.source,
        startTime: duplicate.startTime,
        endTime: duplicate.endTime,
      });
    }
  }

  const durationMinutes = Math.max(
    1,
    Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60_000)
  );

  let suggestedSlots: CalendarConflictResult["suggestedSlots"] = [];
  if (conflicts.length > 0) {
    const slots = await findAvailableSlotsForOrganization({
      organizationId,
      from: input.startAt,
      to: new Date(input.startAt.getTime() + 7 * 24 * 60 * 60_000),
      durationMinutes,
      serviceId: input.serviceId,
      limit: params.suggestionLimit ?? 3,
      excludeCalendarEventId: params.excludeCalendarEventId,
      excludeAppointmentId: params.excludeAppointmentId,
      assignedUserId: input.assignedUserId,
      now: params.now,
    });
    suggestedSlots = slots.slots;
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    suggestedSlots,
  };
}

async function checkDuplicateMeeting(params: {
  organizationId: string;
  clientId: string;
  startAt: Date;
  endAt: Date;
  excludeCalendarEventId?: string;
}): Promise<{ id: string; source: string; startTime: string; endTime: string } | null> {
  const { prisma } = await import("../../lib/prisma.js");

  const calendarEvent = await prisma.calendarEvent.findFirst({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      status: { in: ["draft", "pending_readiness", "confirmed", "in_progress"] },
      startAt: { lt: params.endAt },
      endAt: { gt: params.startAt },
      ...(params.excludeCalendarEventId ? { id: { not: params.excludeCalendarEventId } } : {}),
    },
    select: { id: true, startAt: true, endAt: true },
  });
  if (calendarEvent) {
    return {
      id: calendarEvent.id,
      source: "calendar_event",
      startTime: calendarEvent.startAt.toISOString(),
      endTime: calendarEvent.endAt.toISOString(),
    };
  }

  const appointment = await prisma.appointment.findFirst({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      status: { notIn: ["cancelled"] },
      startTime: { lt: params.endAt },
    },
    select: { id: true, startTime: true, durationMinutes: true },
  });
  if (appointment) {
    const end = new Date(appointment.startTime.getTime() + appointment.durationMinutes * 60_000);
    if (end > params.startAt) {
      return {
        id: appointment.id,
        source: "appointment",
        startTime: appointment.startTime.toISOString(),
        endTime: end.toISOString(),
      };
    }
  }

  return null;
}
