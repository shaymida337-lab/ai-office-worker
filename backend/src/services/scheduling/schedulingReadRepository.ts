import { prisma } from "../../lib/prisma.js";
import { listGoogleCalendarEventsInRange } from "../google.js";
import { dedupeSchedulingItems } from "./schedulingDedup.js";

/**
 * Single source of truth for appointment READS.
 *
 * Appointments live in two tables depending on org/engine flags:
 *  - legacy `Appointment`
 *  - `CalendarEvent` (calendar engine)
 * plus optional Google Calendar read-through for events that exist only there.
 *
 * Natalie (list / search / cancel / move resolution) must find bookings
 * regardless of which table they are stored in, so every read here merges
 * sources into one unified `SchedulingItem`. Google-only rows are tagged
 * `google_calendar` and are display/availability only (not cancel/reschedule IDs).
 */

export type SchedulingSource = "appointment" | "calendar_event" | "google_calendar";

export type SchedulingItem = {
  id: string;
  source: SchedulingSource;
  clientId: string | null;
  clientName: string;
  serviceName?: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
  googleEventId?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type UpcomingSchedulingReadResult = {
  items: SchedulingItem[];
  /** Legacy warning string kept for compatibility with existing callers. */
  googleReadWarningHe?: string;
  googleReadStatus: "full" | "partial" | "local_only" | "unavailable";
  googleReadDegraded: boolean;
  googleReadReason?: string;
  googleReadStatusCode?: number;
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
  /** Upper bound for Google list window. Defaults to now + 30 days. */
  until?: Date;
  /** Skip Google read-through (tests). Default false. */
  skipGoogle?: boolean;
  /** Test-only: inject Google-only scheduling rows. */
  googleItems?: SchedulingItem[];
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
      client: { select: { id: true, name: true, email: true, whatsappNumber: true } },
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
    googleEventId: appointment.googleEventId,
    phone: appointment.client?.whatsappNumber ?? null,
    email: appointment.client?.email ?? null,
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
      client: { select: { id: true, name: true, email: true, whatsappNumber: true } },
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
    googleEventId: event.googleEventId,
    phone: event.client?.whatsappNumber ?? null,
    email: event.client?.email ?? null,
  }));
}

async function readGoogleOnlyEvents(params: {
  organizationId: string;
  from: Date;
  until: Date;
}): Promise<{
  items: SchedulingItem[];
  warningHe?: string;
  status: "full" | "partial" | "local_only" | "unavailable";
  degraded: boolean;
  reason?: string;
  statusCode?: number;
}> {
  const result = await listGoogleCalendarEventsInRange(params.organizationId, {
    start: params.from,
    end: params.until,
  });
  if (!result.ok) {
    if (result.reason === "not_connected") {
      return {
        items: [],
        warningHe: result.messageHe,
        status: "local_only",
        degraded: false,
        reason: result.reason,
        statusCode: result.statusCode,
      };
    }
    return {
      items: [],
      warningHe: result.messageHe,
      status: "unavailable",
      degraded: true,
      reason: result.reason,
      statusCode: result.statusCode,
    };
  }

  const items: SchedulingItem[] = result.events
    .filter((event) => event.start.getTime() >= params.from.getTime())
    .map((event) => ({
      id: `gcal:${event.googleEventId}`,
      source: "google_calendar" as const,
      clientId: null,
      clientName: event.summary,
      startTime: event.start,
      durationMinutes: Math.max(1, Math.round((event.end.getTime() - event.start.getTime()) / 60_000)),
      status: "confirmed",
      googleEventId: event.googleEventId,
    }));

  return {
    items,
    warningHe: result.partial ? result.messageHe : undefined,
    status: result.partial ? "partial" : "full",
    degraded: result.partial,
    reason: result.partial ? "partial_response" : undefined,
  };
}

export function mergeAndCap(
  appointments: SchedulingItem[],
  events: SchedulingItem[],
  limit: number,
  extras: SchedulingItem[] = [],
  organizationId?: string
): SchedulingItem[] {
  const merged = dedupeSchedulingItems(
    [...appointments, ...events, ...extras].map((item) => ({
      ...item,
      organizationId,
    })),
    organizationId
  );

  return merged
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, limit);
}

/**
 * Upcoming bookings across BOTH tables for the whole organization.
 * Always reads both tables (never gated by engine flags) so nothing is missed.
 * Optionally merges Google Calendar read-through (deduped against DB mirrors).
 */
export async function getUpcomingSchedulingForOrganization(
  params: CommonReadParams
): Promise<SchedulingItem[]> {
  const result = await getUpcomingSchedulingForOrganizationDetailed(params);
  return result.items;
}

export async function getUpcomingSchedulingForOrganizationDetailed(
  params: CommonReadParams
): Promise<UpcomingSchedulingReadResult> {
  const from = params.now ?? new Date();
  const limit = params.limit ?? 50;
  const until = params.until ?? new Date(from.getTime() + 30 * 24 * 60 * 60_000);

  const [appointments, events, google] = await Promise.all([
    readAppointments({ organizationId: params.organizationId, from, limit }),
    readCalendarEvents({ organizationId: params.organizationId, from, limit }),
    params.googleItems
      ? Promise.resolve({
          items: params.googleItems,
          warningHe: undefined as string | undefined,
          status: "full" as const,
          degraded: false,
          reason: undefined as string | undefined,
          statusCode: undefined as number | undefined,
        })
      : params.skipGoogle
        ? Promise.resolve({
            items: [] as SchedulingItem[],
            warningHe: undefined as string | undefined,
            status: "local_only" as const,
            degraded: false,
            reason: "skip_google",
            statusCode: undefined as number | undefined,
          })
        : readGoogleOnlyEvents({ organizationId: params.organizationId, from, until }),
  ]);

  return {
    items: mergeAndCap(appointments, events, limit, google.items, params.organizationId),
    googleReadWarningHe: google.warningHe,
    googleReadStatus: google.status,
    googleReadDegraded: google.degraded,
    googleReadReason: google.reason,
    googleReadStatusCode: google.statusCode,
  };
}

/**
 * Upcoming bookings across BOTH tables for a single client.
 * `clientId` is matched inside the org scope, preserving organization isolation.
 * Google-only events are omitted here (no client linkage).
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
  return mergeAndCap(appointments, events, limit, [], params.organizationId);
}
