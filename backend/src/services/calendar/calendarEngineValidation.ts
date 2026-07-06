import { prisma } from "../../lib/prisma.js";
import { isInPast, isWithinWorkingHours } from "./engine.js";
import { getCalendarRulesForOrganization } from "./rules.js";
import { loadCombinedBusyBlocks } from "./calendarEventBlocks.js";
import { checkConflict } from "./engine.js";
import type { CalendarEngineEventInput, CalendarValidationResult } from "./calendarEngineTypes.js";

const DUPLICATE_WINDOW_MS = 60_000;

export type ValidateEventParams = {
  organizationId: string;
  input: CalendarEngineEventInput;
  excludeCalendarEventId?: string;
  now?: Date;
};

function issue(
  code: CalendarValidationResult["issues"][number]["code"],
  message: string,
  field?: string
): CalendarValidationResult["issues"][number] {
  return { code, message, field };
}

export async function validateEvent(params: ValidateEventParams): Promise<CalendarValidationResult> {
  const issues: CalendarValidationResult["issues"] = [];
  const { input, organizationId } = params;
  const now = params.now ?? new Date();

  if (!input.startAt || Number.isNaN(input.startAt.getTime())) {
    issues.push(issue("MISSING_REQUIRED_FIELD", "startAt is required", "startAt"));
  }
  if (!input.endAt || Number.isNaN(input.endAt.getTime())) {
    issues.push(issue("MISSING_REQUIRED_FIELD", "endAt is required", "endAt"));
  }
  if (issues.length > 0) {
    return { valid: false, issues };
  }

  if (input.endAt <= input.startAt) {
    issues.push(issue("INVALID_TIME_RANGE", "endAt must be after startAt", "endAt"));
  }

  if (isInPast(input.startAt, now)) {
    issues.push(issue("PAST_START_TIME", "startAt cannot be in the past", "startAt"));
  }

  const rules = await getCalendarRulesForOrganization(organizationId);
  const interval = { start: input.startAt, end: input.endAt };

  if (!isWithinWorkingHours(interval, rules)) {
    issues.push(
      issue(
        "OUTSIDE_WORKING_HOURS",
        `Event must be within working hours ${rules.workingStartHour}:00–${rules.workingEndHour}:00`,
        "startAt"
      )
    );
  }

  if (input.assignedUserId) {
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId, userId: input.assignedUserId },
      select: { id: true },
    });
    if (!member) {
      issues.push(issue("INVALID_ATTENDEE", "assignedUserId does not belong to organization", "assignedUserId"));
    }
  }

  if (input.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, organizationId },
      select: { id: true },
    });
    if (!client) {
      issues.push(issue("INVALID_ATTENDEE", "clientId does not belong to organization", "clientId"));
    }
  }

  if (!rules.allowBackToBack) {
    const range = {
      start: new Date(input.startAt.getTime() - 24 * 60 * 60_000),
      end: new Date(input.endAt.getTime() + 24 * 60 * 60_000),
    };
    const busyBlocks = await loadCombinedBusyBlocks(organizationId, range, {
      excludeCalendarEventId: params.excludeCalendarEventId,
      assignedUserId: input.assignedUserId,
    });
    const bufferResult = checkConflict(interval, busyBlocks, {
      excludeId: params.excludeCalendarEventId,
      allowBackToBack: false,
    });
    if (!bufferResult.available) {
      issues.push(issue("BUFFER_VIOLATION", "Event violates required buffer between appointments", "startAt"));
    }
  }

  const duplicate = await findDuplicateEvent({
    organizationId,
    clientId: input.clientId,
    startAt: input.startAt,
    endAt: input.endAt,
    excludeCalendarEventId: params.excludeCalendarEventId,
    now,
  });
  if (duplicate) {
    issues.push(issue("DUPLICATE_REQUEST", "An equivalent event was scheduled recently", "startAt"));
  }

  return { valid: issues.length === 0, issues };
}

async function findDuplicateEvent(params: {
  organizationId: string;
  clientId?: string | null;
  startAt: Date;
  endAt: Date;
  excludeCalendarEventId?: string;
  now: Date;
}): Promise<{ id: string } | null> {
  const windowStart = new Date(params.startAt.getTime() - DUPLICATE_WINDOW_MS);
  const windowEnd = new Date(params.startAt.getTime() + DUPLICATE_WINDOW_MS);

  const event = await prisma.calendarEvent.findFirst({
    where: {
      organizationId: params.organizationId,
      startAt: { gte: windowStart, lte: windowEnd },
      endAt: params.endAt,
      status: { notIn: ["cancelled", "rescheduled"] },
      ...(params.clientId ? { clientId: params.clientId } : {}),
      ...(params.excludeCalendarEventId ? { id: { not: params.excludeCalendarEventId } } : {}),
    },
    select: { id: true },
  });
  if (event) return event;

  const appointment = await prisma.appointment.findFirst({
    where: {
      organizationId: params.organizationId,
      startTime: { gte: windowStart, lte: windowEnd },
      status: { notIn: ["cancelled"] },
      ...(params.clientId ? { clientId: params.clientId } : {}),
    },
    select: { id: true },
  });
  return appointment;
}
