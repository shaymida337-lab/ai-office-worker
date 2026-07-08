import { prisma } from "../../lib/prisma.js";
import { loadCombinedBusyBlocksDetailed } from "./calendarEventBlocks.js";
import {
  appointmentEnd,
  checkConflict,
  findAvailableSlots,
  findAvailableSlotsNearTime,
  isInPast,
  isWithinWorkingHours,
} from "./engine.js";
import {
  buildSlotRankingOptions,
  slotLocalTimeString,
  type SlotRankingMode,
  type SlotTimeConstraint,
} from "./slotRanking.js";
import {
  addCalendarDays,
  formatSlotLabel,
  getDayBounds,
  getLocalDateParts,
  getWeekBounds,
  resolveSlotTime,
  wallClockToDate,
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
  /** Test / dial-down: skip Google Calendar read-through. */
  skipGoogle?: boolean;
  /** Test-only: inject Google busy blocks. */
  googleBlocks?: BusyBlock[];
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

  const busyRead = await loadCombinedBusyBlocksDetailed(params.organizationId, candidate, {
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
    skipGoogle: params.skipGoogle,
    googleBlocks: params.googleBlocks,
  });
  const busyBlocks = busyRead.blocks;

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
      googleReadStatus: busyRead.google.status,
      googleReadDegraded: busyRead.google.degraded,
      googleReadReason: busyRead.google.reason,
      googleReadStatusCode: busyRead.google.statusCode,
      googleReadMessageHe: busyRead.google.messageHe,
    };
  }

  if (busyRead.google.degraded) {
    return {
      ...base,
      available: false,
      reason: "google_unavailable",
      googleReadStatus: busyRead.google.status,
      googleReadDegraded: true,
      googleReadReason: busyRead.google.reason,
      googleReadStatusCode: busyRead.google.statusCode,
      googleReadMessageHe: busyRead.google.messageHe,
    };
  }

  return {
    ...base,
    available: true,
    googleReadStatus: busyRead.google.status,
    googleReadDegraded: false,
  };
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
  skipGoogle?: boolean;
  googleBlocks?: BusyBlock[];
  timeConstraints?: SlotTimeConstraint[];
  rankingMode?: SlotRankingMode;
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

  const busyRead = await loadCombinedBusyBlocksDetailed(params.organizationId, range, {
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
    skipGoogle: params.skipGoogle,
    googleBlocks: params.googleBlocks,
  });
  const busyBlocks = busyRead.blocks;

  const slots = findAvailableSlots(range, durationMinutes, busyBlocks, rules, {
    limit,
    slotStepMinutes,
    now,
    excludeId: params.excludeCalendarEventId ?? params.excludeAppointmentId,
    ranking: buildSlotRankingOptions(rules, {
      mode: params.rankingMode ?? "default",
      constraints: params.timeConstraints,
    }),
  });

  if (busyRead.google.degraded) {
    return {
      timeZone: rules.timeZone,
      durationMinutes,
      searchedFrom: range.start.toISOString(),
      searchedTo: range.end.toISOString(),
      slots: [],
      empty: false,
      googleReadStatus: busyRead.google.status,
      googleReadDegraded: true,
      googleReadReason: busyRead.google.reason,
      googleReadStatusCode: busyRead.google.statusCode,
      googleReadMessageHe: busyRead.google.messageHe,
    };
  }

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
    googleReadStatus: busyRead.google.status,
    googleReadDegraded: false,
  };
}

export type NearbyAlternativeSlotsResult = FindAvailableSlotsResult & {
  fellBackToNextDay: boolean;
};

const NEARBY_ALTERNATIVE_HOURS = 3;

export async function findNearbyAlternativeSlots(params: {
  organizationId: string;
  requestedStart: Date;
  durationMinutes?: number;
  serviceId?: string | null;
  limit?: number;
  nearbyHours?: number;
  now?: Date;
  skipGoogle?: boolean;
  googleBlocks?: BusyBlock[];
}): Promise<NearbyAlternativeSlotsResult> {
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const now = params.now ?? new Date();
  const durationMinutes = await resolveDurationMinutes({
    organizationId: params.organizationId,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    defaultDurationMinutes: rules.defaultDurationMinutes,
  });
  const limit = params.limit ?? 3;
  const nearbyHours = params.nearbyHours ?? NEARBY_ALTERNATIVE_HOURS;

  const sameDayRange = getDayBounds(params.requestedStart, rules.timeZone);
  const busyReadSameDay = await loadCombinedBusyBlocksDetailed(params.organizationId, sameDayRange, {
    skipGoogle: params.skipGoogle,
    googleBlocks: params.googleBlocks,
  });

  if (busyReadSameDay.google.degraded) {
    return {
      timeZone: rules.timeZone,
      durationMinutes,
      searchedFrom: sameDayRange.start.toISOString(),
      searchedTo: sameDayRange.end.toISOString(),
      slots: [],
      empty: false,
      fellBackToNextDay: false,
      googleReadStatus: busyReadSameDay.google.status,
      googleReadDegraded: true,
      googleReadReason: busyReadSameDay.google.reason,
      googleReadStatusCode: busyReadSameDay.google.statusCode,
      googleReadMessageHe: busyReadSameDay.google.messageHe,
    };
  }

  let slotCandidates = findAvailableSlotsNearTime(
    params.requestedStart,
    sameDayRange,
    durationMinutes,
    busyReadSameDay.blocks,
    rules,
    { nearbyHours, limit, now }
  );
  let fellBackToNextDay = false;
  let searchedFrom = sameDayRange.start;
  let searchedTo = sameDayRange.end;

  if (slotCandidates.length === 0) {
    fellBackToNextDay = true;
    const nextDayParts = addCalendarDays(getLocalDateParts(params.requestedStart, rules.timeZone), 1);
    const nextDayAnchor = wallClockToDate(
      nextDayParts.year,
      nextDayParts.month,
      nextDayParts.day,
      0,
      0,
      rules.timeZone
    );
    if (!nextDayAnchor) {
      return {
        timeZone: rules.timeZone,
        durationMinutes,
        searchedFrom: sameDayRange.start.toISOString(),
        searchedTo: sameDayRange.end.toISOString(),
        slots: [],
        empty: true,
        fellBackToNextDay: true,
        googleReadStatus: busyReadSameDay.google.status,
        googleReadDegraded: false,
      };
    }

    const nextDayRange = getDayBounds(nextDayAnchor, rules.timeZone);
    searchedFrom = nextDayRange.start;
    searchedTo = nextDayRange.end;

    const busyReadNextDay = await loadCombinedBusyBlocksDetailed(params.organizationId, nextDayRange, {
      skipGoogle: params.skipGoogle,
      googleBlocks: params.googleBlocks,
    });

    if (busyReadNextDay.google.degraded) {
      return {
        timeZone: rules.timeZone,
        durationMinutes,
        searchedFrom: nextDayRange.start.toISOString(),
        searchedTo: nextDayRange.end.toISOString(),
        slots: [],
        empty: false,
        fellBackToNextDay: true,
        googleReadStatus: busyReadNextDay.google.status,
        googleReadDegraded: true,
        googleReadReason: busyReadNextDay.google.reason,
        googleReadStatusCode: busyReadNextDay.google.statusCode,
        googleReadMessageHe: busyReadNextDay.google.messageHe,
      };
    }

    slotCandidates = findAvailableSlots(
      nextDayRange,
      durationMinutes,
      busyReadNextDay.blocks,
      rules,
      { limit, now }
    );
  }

  return {
    timeZone: rules.timeZone,
    durationMinutes,
    searchedFrom: searchedFrom.toISOString(),
    searchedTo: searchedTo.toISOString(),
    slots: slotCandidates.map((slot) => ({
      startTime: slot.start.toISOString(),
      endTime: slot.end.toISOString(),
      label: formatSlotLabel(slot.start, rules.timeZone, now),
    })),
    empty: slotCandidates.length === 0,
    fellBackToNextDay,
    googleReadStatus: busyReadSameDay.google.status,
    googleReadDegraded: false,
  };
}

export async function findBestAvailableSlotForOrganization(params: {
  organizationId: string;
  dayReference: string;
  durationMinutes?: number;
  serviceId?: string | null;
  timeConstraints?: SlotTimeConstraint[];
  now?: Date;
  skipGoogle?: boolean;
}): Promise<{ time: string; slot: FindAvailableSlotsResult["slots"][number] } | null> {
  const result = await findAvailableSlotsForOrganization({
    organizationId: params.organizationId,
    dayReference: params.dayReference,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    limit: 1,
    rankingMode: "best_available",
    timeConstraints: params.timeConstraints,
    now: params.now,
    skipGoogle: params.skipGoogle,
  });

  if (result.empty || result.googleReadDegraded || result.slots.length === 0) {
    return null;
  }

  const slot = result.slots[0]!;
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const time = slotLocalTimeString(
    { start: new Date(slot.startTime), end: new Date(slot.endTime), durationMinutes: result.durationMinutes },
    rules.timeZone
  );

  return { time, slot };
}
