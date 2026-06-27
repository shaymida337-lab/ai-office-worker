import { prisma } from "../../lib/prisma.js";
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
  }
): Promise<BusyBlock[]> {
  const [appointments, calendarEvents] = await Promise.all([
    loadAppointmentBusyBlocks(organizationId, range, {
      excludeAppointmentId: options?.excludeAppointmentId,
    }),
    loadCalendarEventBusyBlocks(organizationId, range, {
      excludeCalendarEventId: options?.excludeCalendarEventId,
      assignedUserId: options?.assignedUserId,
    }),
  ]);

  return [...appointments, ...calendarEvents].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}
