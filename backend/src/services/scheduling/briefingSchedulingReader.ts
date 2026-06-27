import { prisma } from "../../lib/prisma.js";
import { resolveCalendarEngineFlags } from "../calendar/calendarEngineFlags.js";
import { getDayBounds } from "../calendar/datetime.js";
import type { CalendarEventStatus, DecisionQueueType } from "../calendar/enums.js";
import { getCalendarRulesForOrganization } from "../calendar/rules.js";
import { hebrewDecisionType, hebrewEventStatus } from "../calendar/timelineSummaries.js";

export type BriefingSchedulingSource = "appointment" | "calendar_event";

export type BriefingUpcomingItem = {
  id: string;
  source: BriefingSchedulingSource;
  clientName: string;
  serviceName?: string;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  status: string;
  statusLabel: string;
  pendingOwnerApproval: boolean;
};

export type BriefingPendingDecision = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  reason?: string | null;
  calendarEventId?: string | null;
  createdAt: string;
  href: string;
};

export type BriefingTodaySummary = {
  upcomingCount: number;
  pendingDecisionCount: number;
  todayCompletedCount: number;
  todayNoShowCount: number;
  todayCancelledCount: number;
};

export type BriefingSchedulingSnapshot = {
  engineReadEnabled: boolean;
  upcoming: BriefingUpcomingItem[];
  pendingDecisions: BriefingPendingDecision[];
  todaySummary: BriefingTodaySummary;
};

const APPOINTMENT_STATUS_HE: Record<string, string> = {
  pending: "ממתין לאישור",
  confirmed: "מאושר",
  cancelled: "בוטל",
  completed: "הושלם",
  no_show: "לא הגיע",
};

export function briefingDecisionHref(decisionId: string): string {
  return `/dashboard/calendar?decisionId=${encodeURIComponent(decisionId)}`;
}

function mapAppointmentToUpcoming(
  appointment: {
    id: string;
    startTime: Date;
    durationMinutes: number;
    status: string;
    client: { name: string };
    service: { name: string } | null;
  },
  now: Date
): BriefingUpcomingItem | null {
  if (appointment.startTime.getTime() < now.getTime()) return null;
  return {
    id: appointment.id,
    source: "appointment",
    clientName: appointment.client.name,
    serviceName: appointment.service?.name ?? undefined,
    startTime: appointment.startTime.toISOString(),
    endTime: new Date(appointment.startTime.getTime() + appointment.durationMinutes * 60_000).toISOString(),
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
    statusLabel: APPOINTMENT_STATUS_HE[appointment.status] ?? appointment.status,
    pendingOwnerApproval: appointment.status.toLowerCase() === "pending",
  };
}

function mapCalendarEventToUpcoming(
  event: {
    id: string;
    startAt: Date;
    endAt: Date;
    status: string;
    title: string | null;
    client: { name: string } | null;
    service: { name: string; durationMinutes: number } | null;
  },
  now: Date
): BriefingUpcomingItem | null {
  if (event.startAt.getTime() < now.getTime()) return null;
  const durationMinutes = Math.max(
    1,
    Math.round((event.endAt.getTime() - event.startAt.getTime()) / 60_000) ||
      event.service?.durationMinutes ||
      30
  );
  return {
    id: event.id,
    source: "calendar_event",
    clientName: event.client?.name ?? (event.title?.trim() || "לקוח"),
    serviceName: event.service?.name ?? undefined,
    startTime: event.startAt.toISOString(),
    endTime: event.endAt.toISOString(),
    durationMinutes,
    status: event.status,
    statusLabel: hebrewEventStatus(event.status as CalendarEventStatus),
    pendingOwnerApproval: event.status === "pending_readiness",
  };
}

export async function getBriefingSchedulingSnapshot(
  organizationId: string,
  params?: { from?: Date; to?: Date; now?: Date }
): Promise<BriefingSchedulingSnapshot> {
  const now = params?.now ?? new Date();
  const from = params?.from ?? now;
  const to = params?.to ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const flags = await resolveCalendarEngineFlags(organizationId);
  const engineReadEnabled = flags.readEnabled;

  const appointments = await prisma.appointment.findMany({
    where: {
      organizationId,
      startTime: { gte: from, lt: to },
      status: { not: "cancelled" },
    },
    include: {
      client: { select: { name: true } },
      service: { select: { name: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const upcomingFromAppointments = appointments
    .map((appointment) => mapAppointmentToUpcoming(appointment, now))
    .filter((item): item is BriefingUpcomingItem => item !== null);

  let upcomingFromEngine: BriefingUpcomingItem[] = [];
  let pendingDecisions: BriefingPendingDecision[] = [];
  let todayCompletedCount = 0;
  let todayNoShowCount = 0;
  let todayCancelledCount = 0;

  if (engineReadEnabled) {
    const rules = await getCalendarRulesForOrganization(organizationId);
    const todayBounds = getDayBounds(now, rules.timeZone);

    const [events, decisions, todayTerminalEvents] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          organizationId,
          startAt: { gte: from, lt: to },
          status: { in: ["pending_readiness", "confirmed"] },
        },
        include: {
          client: { select: { name: true } },
          service: { select: { name: true, durationMinutes: true } },
        },
        orderBy: { startAt: "asc" },
      }),
      prisma.ownerDecisionQueueItem.findMany({
        where: { organizationId, status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.calendarEvent.findMany({
        where: {
          organizationId,
          status: { in: ["completed", "no_show", "cancelled"] },
          startAt: { gte: todayBounds.start, lt: todayBounds.end },
        },
        select: { status: true },
      }),
    ]);

    upcomingFromEngine = events
      .map((event) => mapCalendarEventToUpcoming(event, now))
      .filter((item): item is BriefingUpcomingItem => item !== null);

    pendingDecisions = decisions.map((decision) => ({
      id: decision.id,
      type: decision.type,
      typeLabel: hebrewDecisionType(decision.type as DecisionQueueType),
      title: decision.title,
      reason: decision.reason,
      calendarEventId: decision.calendarEventId,
      createdAt: decision.createdAt.toISOString(),
      href: briefingDecisionHref(decision.id),
    }));

    for (const event of todayTerminalEvents) {
      if (event.status === "completed") todayCompletedCount += 1;
      else if (event.status === "no_show") todayNoShowCount += 1;
      else if (event.status === "cancelled") todayCancelledCount += 1;
    }
  }

  const upcoming = [...upcomingFromAppointments, ...upcomingFromEngine].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const pendingAppointmentCount = upcomingFromAppointments.filter((item) => item.pendingOwnerApproval).length;
  const pendingDecisionCount = engineReadEnabled
    ? pendingDecisions.length
    : pendingAppointmentCount;

  return {
    engineReadEnabled,
    upcoming,
    pendingDecisions,
    todaySummary: {
      upcomingCount: upcoming.length,
      pendingDecisionCount,
      todayCompletedCount,
      todayNoShowCount,
      todayCancelledCount,
    },
  };
}
