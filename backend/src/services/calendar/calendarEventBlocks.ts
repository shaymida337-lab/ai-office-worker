import { prisma } from "../../lib/prisma.js";
import { listGoogleCalendarEventsInRange } from "../google.js";
import { dedupeSchedulingItems } from "../scheduling/schedulingDedup.js";
import { loadAppointmentBusyBlocks } from "./blocks.js";
import type { BusyBlock, TimeInterval } from "./types.js";

const BLOCKING_CALENDAR_EVENT_STATUSES = ["pending_readiness", "confirmed"] as const;

export async function loadCalendarEventBusyBlocks(
  organizationId: string,
  range: TimeInterval,
  options?: { excludeCalendarEventId?: string; assignedUserId?: string | null }
): Promise<BusyBlock[]> {
  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId,
      status: { in: [...BLOCKING_CALENDAR_EVENT_STATUSES] },
      startAt: { lt: range.end },
      ...(options?.excludeCalendarEventId ? { id: { not: options.excludeCalendarEventId } } : {}),
      ...(options?.assignedUserId ? { assignedUserId: options.assignedUserId } : {}),
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      googleEventId: true,
      client: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startAt: "asc" },
  });

  const blocks: BusyBlock[] = [];
  for (const event of events) {
    if (event.endAt.getTime() <= range.start.getTime()) continue;
    if (event.startAt.getTime() >= range.end.getTime()) continue;

    blocks.push({
      id: event.id,
      source: "calendar_event",
      start: event.startAt,
      end: event.endAt,
      clientName: event.client?.name,
      serviceName: event.service?.name ?? undefined,
      durationMinutes: Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60_000),
      googleEventId: event.googleEventId,
    });
  }

  return blocks;
}

async function loadKnownGoogleEventIds(
  organizationId: string,
  range: TimeInterval
): Promise<Set<string>> {
  const [appointments, events] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        organizationId,
        status: { not: "cancelled" },
        startTime: { lt: range.end },
        googleEventId: { not: null },
      },
      select: { googleEventId: true, startTime: true, durationMinutes: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        organizationId,
        status: { in: [...BLOCKING_CALENDAR_EVENT_STATUSES] },
        startAt: { lt: range.end },
        googleEventId: { not: null },
      },
      select: { googleEventId: true, startAt: true, endAt: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const appointment of appointments) {
    if (!appointment.googleEventId) continue;
    const end = new Date(appointment.startTime.getTime() + appointment.durationMinutes * 60_000);
    if (end.getTime() <= range.start.getTime()) continue;
    if (appointment.startTime.getTime() >= range.end.getTime()) continue;
    ids.add(appointment.googleEventId);
  }
  for (const event of events) {
    if (!event.googleEventId) continue;
    if (event.endAt.getTime() <= range.start.getTime()) continue;
    if (event.startAt.getTime() >= range.end.getTime()) continue;
    ids.add(event.googleEventId);
  }
  return ids;
}

/**
 * Soft-fail Google busy read-through. On permission/API failure returns [] so
 * Natalie still uses local busy data; callers that need honest messaging should
 * use listGoogleCalendarEventsInRange / getUpcomingSchedulingForOrganization.
 */
export async function loadGoogleCalendarBusyBlocks(
  organizationId: string,
  range: TimeInterval
): Promise<BusyBlock[]> {
  const result = await listGoogleCalendarEventsInRange(organizationId, range);
  if (!result.ok) {
    if (result.reason !== "not_connected") {
      console.warn(
        `[calendar/busy] google read skipped org=${organizationId} reason=${result.reason}`
      );
    }
    return [];
  }

  const mirroredIds = await loadKnownGoogleEventIds(organizationId, range);
  const blocks: BusyBlock[] = [];
  for (const event of result.events) {
    if (mirroredIds.has(event.googleEventId)) continue;
    blocks.push({
      id: `gcal:${event.googleEventId}`,
      source: "google_calendar",
      start: event.start,
      end: event.end,
      clientName: event.summary,
      durationMinutes: Math.max(1, Math.round((event.end.getTime() - event.start.getTime()) / 60_000)),
      googleEventId: event.googleEventId,
    });
  }
  return blocks;
}

export async function loadCombinedBusyBlocks(
  organizationId: string,
  range: TimeInterval,
  options?: {
    excludeAppointmentId?: string;
    excludeCalendarEventId?: string;
    assignedUserId?: string | null;
    /** When true, skip Google read-through (tests / dial-down). Default false. */
    skipGoogle?: boolean;
    /** Test-only: inject Google blocks instead of calling the Google API. */
    googleBlocks?: BusyBlock[];
  }
): Promise<BusyBlock[]> {
  const [appointments, calendarEvents, googleBlocks] = await Promise.all([
    loadAppointmentBusyBlocks(organizationId, range, {
      excludeAppointmentId: options?.excludeAppointmentId,
    }),
    loadCalendarEventBusyBlocks(organizationId, range, {
      excludeCalendarEventId: options?.excludeCalendarEventId,
      assignedUserId: options?.assignedUserId,
    }),
    options?.googleBlocks
      ? Promise.resolve(options.googleBlocks)
      : options?.skipGoogle
        ? Promise.resolve([] as BusyBlock[])
        : loadGoogleCalendarBusyBlocks(organizationId, range),
  ]);

  // Soft dedup among local+google by googleEventId / slot identity so mirrored
  // outbound events + Google read-through do not double-block the same window.
  const merged = dedupeSchedulingItems(
    [...appointments, ...calendarEvents, ...googleBlocks].map((block) => ({
      id: block.id,
      organizationId,
      source: block.source,
      clientName: block.clientName ?? "",
      startTime: block.start,
      durationMinutes:
        block.durationMinutes ??
        Math.max(1, Math.round((block.end.getTime() - block.start.getTime()) / 60_000)),
      googleEventId: block.googleEventId,
    })),
    organizationId
  );

  const byId = new Map(
    [...appointments, ...calendarEvents, ...googleBlocks].map((block) => [block.id, block] as const)
  );

  return merged
    .map((item) => byId.get(item.id))
    .filter((block): block is BusyBlock => Boolean(block))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
