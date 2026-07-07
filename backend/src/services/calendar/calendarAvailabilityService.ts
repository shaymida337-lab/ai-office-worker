import { loadCombinedBusyBlocks } from "./calendarEventBlocks.js";
import { findAvailableSlotsForOrganization, resolveDurationMinutes } from "./availability.js";
import { getDayBounds, getWeekBounds } from "./datetime.js";
import { getCalendarRulesForOrganization } from "./rules.js";
import type { BusyBlock, FindAvailableSlotsResult, TimeInterval } from "./types.js";

export type BusySlotView = {
  id: string;
  source: BusyBlock["source"];
  startTime: string;
  endTime: string;
  clientName?: string;
  serviceName?: string;
};

export type AvailabilityLookupParams = {
  organizationId: string;
  dayReference?: string;
  durationMinutes?: number;
  serviceId?: string | null;
  limit?: number;
  rangeType?: "day" | "week";
  from?: Date;
  to?: Date;
  excludeAppointmentId?: string;
  excludeCalendarEventId?: string;
  assignedUserId?: string | null;
  now?: Date;
};

function mapBusy(block: BusyBlock): BusySlotView {
  return {
    id: block.id,
    source: block.source,
    startTime: block.start.toISOString(),
    endTime: block.end.toISOString(),
    clientName: block.clientName,
    serviceName: block.serviceName,
  };
}

async function resolveRange(params: AvailabilityLookupParams): Promise<TimeInterval> {
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const now = params.now ?? new Date();
  if (params.from && params.to) return { start: params.from, end: params.to };
  if (params.rangeType === "week" || params.dayReference === "השבוע") {
    return getWeekBounds(now, rules.timeZone);
  }
  if (params.dayReference) {
    const { resolveSlotTime } = await import("./datetime.js");
    const anchor = resolveSlotTime({
      dayReference: params.dayReference,
      time: "00:00",
      timeZone: rules.timeZone,
      now,
    });
    return getDayBounds(anchor ?? now, rules.timeZone);
  }
  return getDayBounds(now, rules.timeZone);
}

export async function getBusySlots(params: AvailabilityLookupParams): Promise<BusySlotView[]> {
  const range = await resolveRange(params);
  const blocks = await loadCombinedBusyBlocks(params.organizationId, range, {
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
  });
  return blocks.map(mapBusy);
}

export async function getFreeSlots(params: AvailabilityLookupParams): Promise<FindAvailableSlotsResult> {
  return findAvailableSlotsForOrganization({
    organizationId: params.organizationId,
    rangeType: params.rangeType,
    from: params.from,
    to: params.to,
    dayReference: params.dayReference,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    limit: params.limit,
    excludeAppointmentId: params.excludeAppointmentId,
    excludeCalendarEventId: params.excludeCalendarEventId,
    assignedUserId: params.assignedUserId,
    now: params.now,
  });
}

export async function getNextAvailableSlot(
  params: AvailabilityLookupParams
): Promise<FindAvailableSlotsResult["slots"][number] | null> {
  const result = await getFreeSlots({ ...params, limit: 1, rangeType: params.rangeType ?? "week" });
  return result.slots[0] ?? null;
}

export async function getRemainingAvailabilityToday(params: AvailabilityLookupParams) {
  const result = await getFreeSlots({
    ...params,
    dayReference: params.dayReference ?? "היום",
    rangeType: "day",
    limit: params.limit ?? 20,
  });
  return {
    count: result.slots.length,
    slots: result.slots,
    timeZone: result.timeZone,
    durationMinutes: result.durationMinutes,
  };
}

export async function getRemainingAvailabilityThisWeek(params: AvailabilityLookupParams) {
  const result = await getFreeSlots({
    ...params,
    rangeType: "week",
    limit: params.limit ?? 20,
  });
  return {
    count: result.slots.length,
    slots: result.slots,
    timeZone: result.timeZone,
    durationMinutes: result.durationMinutes,
  };
}

export async function lookupAvailabilityByDate(params: AvailabilityLookupParams) {
  if (!params.dayReference) {
    throw new Error("dayReference is required");
  }
  return getFreeSlots({ ...params, rangeType: "day" });
}

export async function lookupAvailabilityByDuration(params: AvailabilityLookupParams & { durationMinutes: number }) {
  const rules = await getCalendarRulesForOrganization(params.organizationId);
  const durationMinutes = await resolveDurationMinutes({
    organizationId: params.organizationId,
    durationMinutes: params.durationMinutes,
    serviceId: params.serviceId,
    defaultDurationMinutes: rules.defaultDurationMinutes,
  });
  return getFreeSlots({ ...params, durationMinutes });
}
