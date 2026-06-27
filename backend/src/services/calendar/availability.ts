import { prisma } from "../../lib/prisma.js";
import { loadCombinedBusyBlocks } from "./calendarEventBlocks.js";
import {
  appointmentEnd,
  checkConflict,
  findAvailableSlots,
  isInPast,
  isWithinWorkingHours,
} from "./engine.js";
import {
  formatSlotLabel,
  getDayBounds,
  getWeekBounds,
  resolveSlotTime,
} from "./datetime.js";
import { getCalendarRulesForOrganization } from "./rules.js";
import type {
  AvailabilityConflictResponse,
  BusyBlock,
  CheckSlotAvailabilityResult,
  FindAvailableSlotsResult,
  TimeInterval,
} from "./types.js";

export async function resolveDurationMinutes(params: {
  organizationId: string;
  durationMinutes?: number;
  serviceId?: string | null;
  defaultDurationMinutes: number;
}): Promise<number> {
  if (params.durationMinutes !== undefined && Number.isFinite(params.durationMinutes)) {
    const value = Number(params.durationMinutes);
    if (value > 0) return value;
  }

  const serviceId = params.serviceId?.trim();
  if (serviceId) {
    const service = await prisma.service.findFirst({
      where: {
        id: serviceId,
        organizationId: params.organizationId,
        isActive: true,
      },
      select: { durationMinutes: true },
    });
    if (service) return service.durationMinutes;
  }

  return params.defaultDurationMinutes;
}

function toConflictResponse(block: BusyBlock): AvailabilityConflictResponse {
  return {
    appointmentId: block.id,
    clientName: block.clientName,
    serviceName: block.serviceName,
    startTime: block.start.toISOString(),
    endTime: block.end.toISOString(),
  };
}

export async function checkSlotAvailability(params: {
  organizationId: string;
  startTime?: Date;
  dayReference?: string;
  time?: string;
  durationMinutes?: number;
  serviceId?: string | null;
  excludeAppointmentId?: string;
  excludeCalendarEventId?: string;
  assignedUserId?: string | null;
  now?: Date;
}): Promise<CheckSlotAvailabilityResult> {
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const now = params.now ?? new Date();

  const durationMinutes = await resolveDurationMinutes({
    organizationId: params.organizationId,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    defaultDurationMinutes: rules.defaultDurationMinutes,
  });

  let resolvedStart = params.startTime ?? null;
  if (!resolvedStart) {
    resolvedStart = resolveSlotTime({
      dayReference: params.dayReference,
      time: params.time,
      timeZone: rules.timeZone,
      now,
    });
  }

  if (!resolvedStart || Number.isNaN(resolvedStart.getTime())) {
    return {
      available: false,
      reason: "bad_datetime",
      startTime: "",
      endTime: "",
      durationMinutes,
      timeZone: rules.timeZone,
    };
  }

  const candidate: TimeInterval = {
    start: resolvedStart,
    end: appointmentEnd(resolvedStart, durationMinutes),
  };

  const base = {
    startTime: candidate.start.toISOString(),
    endTime: candidate.end.toISOString(),
    durationMinutes,
    timeZone: rules.timeZone,
  };

  if (isInPast(candidate.start, now)) {
    return { ...base, available: false, reason: "past" };
  }

  if (!isWithinWorkingHours(candidate, rules)) {
    return { ...base, available: false, reason: "outside_working_hours" };
  }

  const busyBlocks = await loadCombinedBusyBlocks(params.organizationId, candidate, {
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
  });

  const conflictResult = checkConflict(candidate, busyBlocks, {
    excludeId: params.excludeCalendarEventId ?? params.excludeAppointmentId,
    allowBackToBack: rules.allowBackToBack,
  });

  if (!conflictResult.available) {
    return {
      ...base,
      available: false,
      reason: conflictResult.reason ?? "time_conflict",
      conflict: conflictResult.conflict ? toConflictResponse(conflictResult.conflict) : undefined,
    };
  }

  return { ...base, available: true };
}

export async function findAvailableSlotsForOrganization(params: {
  organizationId: string;
  rangeType?: "day" | "week";
  from?: Date;
  to?: Date;
  dayReference?: string;
  durationMinutes?: number;
  serviceId?: string | null;
  limit?: number;
  slotStepMinutes?: number;
  excludeAppointmentId?: string;
  excludeCalendarEventId?: string;
  assignedUserId?: string | null;
  now?: Date;
}): Promise<FindAvailableSlotsResult> {
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const now = params.now ?? new Date();

  const durationMinutes = await resolveDurationMinutes({
    organizationId: params.organizationId,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    defaultDurationMinutes: rules.defaultDurationMinutes,
  });

  const limit = params.limit ?? 3;
  const slotStepMinutes = params.slotStepMinutes ?? rules.slotStepMinutes;

  let range: TimeInterval;
  if (params.from && params.to) {
    range = { start: params.from, end: params.to };
  } else if (params.rangeType === "week") {
    range = getWeekBounds(now, rules.timeZone);
  } else if (params.dayReference) {
    const anchor = resolveSlotTime({
      dayReference: params.dayReference,
      time: "00:00",
      timeZone: rules.timeZone,
      now,
    });
    range = getDayBounds(anchor ?? now, rules.timeZone);
  } else {
    range = getDayBounds(now, rules.timeZone);
  }

  if (range.start.getTime() < now.getTime()) {
    range = { ...range, start: now };
  }

  const busyBlocks = await loadCombinedBusyBlocks(params.organizationId, range, {
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
  });

  const slots = findAvailableSlots(range, durationMinutes, busyBlocks, rules, {
    limit,
    slotStepMinutes,
    now,
    excludeId: params.excludeCalendarEventId ?? params.excludeAppointmentId,
  });

  return {
    timeZone: rules.timeZone,
    durationMinutes,
    searchedFrom: range.start.toISOString(),
    searchedTo: range.end.toISOString(),
    slots: slots.map((slot) => ({
      startTime: slot.start.toISOString(),
      endTime: slot.end.toISOString(),
      label: formatSlotLabel(slot.start, rules.timeZone, now),
    })),
    empty: slots.length === 0,
  };
}
