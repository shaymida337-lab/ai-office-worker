import { prisma } from "../../lib/prisma.js";

/**
 * Single source of truth for appointment READS.
 *
 * Appointments live in two tables depending on org/engine flags:
 *  - legacy `Appointment`
 *  - `CalendarEvent` (calendar engine)
 *
 * Natalie (list / search / cancel / move resolution) must find bookings
 * regardless of which table they are stored in, so every read here merges
 * both tables into one unified `SchedulingItem`. Merge logic mirrors
 * `briefingSchedulingReader.ts`, but returns the `Date`/`clientId` shape the
 * scheduling facade and Natalie resolver already consume.
 */

export type SchedulingSource = "appointment" | "calendar_event";

export type SchedulingItem = {
  id: string;
  source: SchedulingSource;
  clientId: string | null;
  clientName: string;
  serviceName?: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
};

/** Appointment statuses that should never surface as an upcoming booking. */
const APPOINTMENT_EXCLUDED_STATUSES = ["cancelled"] as const;
/** CalendarEvent statuses that represent a live/upcoming booking. */
const CALENDAR_EVENT_ACTIVE_STATUSES = ["pending_readiness", "confirmed"] as const;

function calendarEventDuration(startAt: Date, endAt: Date, serviceDuration?: number | null): number {
  return Math.max(
    1,
    Math.round((endAt.getTime() - startAt.getTime()) / 60_000) || serviceDuration || 30
  );
}

type CommonReadParams = {
  organizationId: string;
  /** Only bookings at/after this instant are returned. Defaults to now. */
  now?: Date;
  limit?: number;
};

async function readAppointments(params: {
  organizationId: string;
  clientId?: string;
  from: Date;
  limit: number;
}): Promise<SchedulingItem[]> {
  const appointments = await prisma.appointment.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      status: { notIn: [...APPOINTMENT_EXCLUDED_STATUSES] },
      startTime: { gte: params.from },
    },
    include: {
      client: { select: { id: true, name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startTime: "asc" },
    take: params.limit,
  });

  return appointments.map((appointment) => ({
    id: appointment.id,
    source: "appointment" as const,
    clientId: appointment.client?.id ?? null,
    clientName: appointment.client?.name ?? "לקוח",
    serviceName: appointment.service?.name ?? undefined,
    startTime: appointment.startTime,
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
  }));
}

async function readCalendarEvents(params: {
  organizationId: string;
  clientId?: string;
  from: Date;
  limit: number;
}): Promise<SchedulingItem[]> {
  const events = await prisma.calendarEvent.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
      status: { in: [...CALENDAR_EVENT_ACTIVE_STATUSES] },
      startAt: { gte: params.from },
    },
    include: {
      client: { select: { id: true, name: true } },
      service: { select: { name: true, durationMinutes: true } },
    },
    orderBy: { startAt: "asc" },
    take: params.limit,
  });

  return events.map((event) => ({
    id: event.id,
    source: "calendar_event" as const,
    clientId: event.client?.id ?? null,
    clientName: event.client?.name ?? (event.title?.trim() || "לקוח"),
    serviceName: event.service?.name ?? undefined,
    startTime: event.startAt,
    durationMinutes: calendarEventDuration(event.startAt, event.endAt, event.service?.durationMinutes),
    status: event.status,
  }));
}

function mergeAndCap(
  appointments: SchedulingItem[],
  events: SchedulingItem[],
  limit: number
): SchedulingItem[] {
  // FUTURE WORK (cross-table dedup): a single booking could theoretically exist
  // in BOTH tables (e.g. mid-migration or a double-write). We intentionally do
  // NOT dedup here yet — dedup needs a stable cross-table identity (clientId +
  // startTime + duration) and careful handling of near-duplicate times, which
  // is out of scope for Calendar V1. Today the read paths simply surface both;
  // duplicates are rare and non-destructive (reads only, writes still require
  // confirmation). Revisit once a canonical booking key exists.
  return [...appointments, ...events]
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, limit);
}

/**
 * Upcoming bookings across BOTH tables for the whole organization.
 * Always reads both tables (never gated by engine flags) so nothing is missed.
 */
export async function getUpcomingSchedulingForOrganization(
  params: CommonReadParams
): Promise<SchedulingItem[]> {
  const from = params.now ?? new Date();
  const limit = params.limit ?? 50;
  const [appointments, events] = await Promise.all([
    readAppointments({ organizationId: params.organizationId, from, limit }),
    readCalendarEvents({ organizationId: params.organizationId, from, limit }),
  ]);
  return mergeAndCap(appointments, events, limit);
}

/**
 * Upcoming bookings across BOTH tables for a single client.
 * `clientId` is matched inside the org scope, preserving organization isolation.
 */
export async function getUpcomingSchedulingForClient(
  params: CommonReadParams & { clientId: string }
): Promise<SchedulingItem[]> {
  const from = params.now ?? new Date();
  const limit = params.limit ?? 10;
  const [appointments, events] = await Promise.all([
    readAppointments({
      organizationId: params.organizationId,
      clientId: params.clientId,
      from,
      limit,
    }),
    readCalendarEvents({
      organizationId: params.organizationId,
      clientId: params.clientId,
      from,
      limit,
    }),
  ]);
  return mergeAndCap(appointments, events, limit);
}
