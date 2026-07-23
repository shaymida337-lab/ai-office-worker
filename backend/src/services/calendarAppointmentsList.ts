/**
 * Ranged calendar appointments list — single Prisma round-trip, bounded, no Google API.
 * Keeps response parity with GET /api/appointments (reminderStatus shape).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export const CALENDAR_APPOINTMENTS_RANGE_MAX = 500;

export const CALENDAR_APPOINTMENT_LIST_SELECT = {
  id: true,
  organizationId: true,
  clientId: true,
  serviceId: true,
  employeeId: true,
  startTime: true,
  durationMinutes: true,
  status: true,
  notes: true,
  source: true,
  googleEventId: true,
  googleSyncStatus: true,
  lastGoogleSyncError: true,
  lastGoogleSyncAt: true,
  googleSyncAttemptCount: true,
  nextGoogleSyncRetryAt: true,
  createdAt: true,
  updatedAt: true,
  client: {
    select: {
      id: true,
      name: true,
      whatsappNumber: true,
      phone: true,
      email: true,
      emailIsPlaceholder: true,
      address: true,
      color: true,
    },
  },
  service: { select: { id: true, name: true, color: true, durationMinutes: true } },
  employee: { select: { id: true, name: true, color: true, isActive: true } },
  attendanceProjection: {
    select: {
      attendanceState: true,
      reminderState: true,
      confirmationStatus: true,
      lastReminderSentAt: true,
      lastResponseAt: true,
    },
  },
  reminderJobs: {
    where: { status: { in: ["pending", "failed", "leased"] } },
    orderBy: { scheduledForUtc: "asc" as const },
    take: 1,
    select: { scheduledForUtc: true },
  },
} as const;

export type CalendarAppointmentListRow = Prisma.AppointmentGetPayload<{
  select: typeof CALENDAR_APPOINTMENT_LIST_SELECT;
}>;

export type CalendarAppointmentListItem = Omit<
  CalendarAppointmentListRow,
  "attendanceProjection" | "reminderJobs"
> & {
  reminderStatus: {
    attendanceState: string;
    reminderState: string;
    confirmationStatus: string;
    lastReminderSentAt: Date | null;
    lastResponseAt: Date | null;
    nextReminderAt: Date | null;
  } | null;
};

export type CalendarAppointmentsListTiming = {
  dbQueryMs: number;
  mapMs: number;
  serializeMs: number;
  totalMs: number;
  rowCount: number;
  prismaCallCount: number;
  organizationLookupCount: number;
};

export type ListCalendarAppointmentsRangeOptions = {
  employeeId?: string;
  collectTiming?: boolean;
  onTiming?: (timing: CalendarAppointmentsListTiming) => void;
};

function employeeWhere(employeeParam: string | undefined): Prisma.AppointmentWhereInput {
  const trimmed = employeeParam?.trim() ?? "";
  if (!trimmed || trimmed === "all") return {};
  if (trimmed === "owner") return { employeeId: null };
  return { employeeId: trimmed };
}

export function mapCalendarAppointmentListRow(row: CalendarAppointmentListRow): CalendarAppointmentListItem {
  const { attendanceProjection, reminderJobs, ...rest } = row;
  const nextReminderAt = reminderJobs[0]?.scheduledForUtc ?? null;
  return {
    ...rest,
    reminderStatus: attendanceProjection
      ? {
          attendanceState: attendanceProjection.attendanceState,
          reminderState: attendanceProjection.reminderState,
          confirmationStatus: attendanceProjection.confirmationStatus,
          lastReminderSentAt: attendanceProjection.lastReminderSentAt,
          lastResponseAt: attendanceProjection.lastResponseAt,
          nextReminderAt,
        }
      : null,
  };
}

/**
 * Bounded range list for calendar First Paint events.
 * Query groups: 1 Prisma findMany (relations loaded in the same call — no N+1 app loops).
 */
export async function listCalendarAppointmentsRange(
  organizationId: string,
  from: Date,
  to: Date,
  options?: ListCalendarAppointmentsRangeOptions
): Promise<CalendarAppointmentListItem[]> {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new Error("Invalid from");
  }
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
    throw new Error("Invalid to");
  }
  if (from >= to) {
    throw new Error("from must be before to");
  }

  const collect = Boolean(options?.collectTiming || options?.onTiming);
  const totalT0 = performance.now();

  const dbT0 = performance.now();
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      startTime: { gte: from, lt: to },
      ...employeeWhere(options?.employeeId),
    },
    select: CALENDAR_APPOINTMENT_LIST_SELECT,
    orderBy: { startTime: "asc" },
    take: CALENDAR_APPOINTMENTS_RANGE_MAX,
  });
  const dbQueryMs = Math.round(performance.now() - dbT0);

  const mapT0 = performance.now();
  const items = rows.map(mapCalendarAppointmentListRow);
  const mapMs = Math.round(performance.now() - mapT0);

  const serializeT0 = performance.now();
  // Force JSON-ready dates; caller may JSON.stringify again — cost captured for timing only.
  JSON.stringify(items);
  const serializeMs = Math.round(performance.now() - serializeT0);

  if (collect) {
    const timing: CalendarAppointmentsListTiming = {
      dbQueryMs,
      mapMs,
      serializeMs,
      totalMs: Math.round(performance.now() - totalT0),
      rowCount: items.length,
      prismaCallCount: 1,
      organizationLookupCount: 0,
    };
    options?.onTiming?.(timing);
    if (process.env.CALENDAR_APPOINTMENTS_TIMING === "1") {
      console.info("[calendar/appointments-range timing]", JSON.stringify(timing));
    }
  }

  return items;
}

/** Stable field whitelist for tests — no histories / timelines / unbounded relations. */
export const CALENDAR_APPOINTMENT_LIST_TOP_LEVEL_KEYS = [
  "id",
  "organizationId",
  "clientId",
  "serviceId",
  "employeeId",
  "startTime",
  "durationMinutes",
  "status",
  "notes",
  "source",
  "googleEventId",
  "googleSyncStatus",
  "lastGoogleSyncError",
  "lastGoogleSyncAt",
  "googleSyncAttemptCount",
  "nextGoogleSyncRetryAt",
  "createdAt",
  "updatedAt",
  "client",
  "service",
  "employee",
  "reminderStatus",
] as const;
