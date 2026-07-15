import { prisma } from "../lib/prisma.js";
import { getDayBounds } from "./calendar/datetime.js";
import { getCalendarRulesForOrganization } from "./calendar/rules.js";
import { resolveCalendarEngineFlags } from "./calendar/calendarEngineFlags.js";
import { countCrmActiveCustomers, countCrmNewLeads } from "./crm/crmCounts.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  loadCrossOrgContaminatedGmailIdsForReads,
  mergePrismaWhere,
} from "./p0/financialReadIsolation.js";

/** Metric keys returned to the dashboard home (insurance overlay + default KPIs). */
export type DashboardHomeMetricId =
  | "active_clients"
  | "open_tasks"
  | "meetings_today"
  | "pending_docs"
  | "new_clients_this_month"
  | "unread_alerts";

export const DASHBOARD_HOME_METRIC_DEFINITIONS: Record<DashboardHomeMetricId, string> = {
  active_clients:
    "CRM active customers: Lead.stage not in [הפסד, סגור], organizationId scoped (same as CRM KPI לקוחות פעילים).",
  open_tasks: 'Task.status="open", organizationId scoped, snapshot count (all time).',
  meetings_today:
    "Appointment + CalendarEvent starting today in org timezone, status not cancelled, organizationId scoped.",
  pending_docs:
    'FinancialDocumentReview.reviewStatus="needs_review" with read isolation, organizationId scoped (matches document-reviews list).',
  new_clients_this_month:
    'CRM new leads: Lead.stage="חדש", organizationId scoped (same as CRM KPI לידים חדשים).',
  unread_alerts: "Alert.read=false, organizationId scoped, snapshot count (all time).",
};

export type DashboardHomeMetricsPayload = {
  organizationId: string;
  computedAt: string;
  timeZone: string;
  metrics: Record<DashboardHomeMetricId, number>;
  definitions: Record<DashboardHomeMetricId, string>;
};

export async function countActiveClients(organizationId: string): Promise<number> {
  // Dashboard “מבוטחים/לקוחות פעילים” must match CRM KPI — Lead open pipeline.
  return countCrmActiveCustomers(organizationId);
}

export async function countOpenTasks(organizationId: string): Promise<number> {
  return prisma.task.count({
    where: { organizationId, status: "open" },
  });
}

export async function countPendingDocumentReviews(organizationId: string): Promise<number> {
  const contaminatedGmailIds = await loadCrossOrgContaminatedGmailIdsForReads();
  return prisma.financialDocumentReview.count({
    where: mergePrismaWhere(
      {
        organizationId,
        reviewStatus: "needs_review",
      },
      buildFinancialDocumentReviewReadIsolationWhere(organizationId, contaminatedGmailIds),
    ),
  });
}

export async function countUnreadAlerts(organizationId: string): Promise<number> {
  return prisma.alert.count({
    where: { organizationId, read: false },
  });
}

export async function countNewClientsThisMonth(organizationId: string): Promise<number> {
  // Dashboard “לקוחות/לידים חדשים” must match CRM KPI “לידים חדשים” (stage=חדש).
  return countCrmNewLeads(organizationId);
}

export async function countMeetingsToday(
  organizationId: string,
  now: Date,
  timeZone: string
): Promise<number> {
  const { start, end } = getDayBounds(now, timeZone);
  const flags = await resolveCalendarEngineFlags(organizationId);

  const appointmentCount = await prisma.appointment.count({
    where: {
      organizationId,
      startTime: { gte: start, lt: end },
      status: { not: "cancelled" },
    },
  });

  if (!flags.readEnabled) {
    return appointmentCount;
  }

  const calendarEventCount = await prisma.calendarEvent.count({
    where: {
      organizationId,
      startAt: { gte: start, lt: end },
      status: { not: "cancelled" },
    },
  });

  return appointmentCount + calendarEventCount;
}

/** Direct prisma counts — used by tests to verify API payload matches DB truth. */
export async function countDashboardHomeMetricsDirect(
  organizationId: string,
  now: Date = new Date()
): Promise<Record<DashboardHomeMetricId, number>> {
  const rules = await getCalendarRulesForOrganization(organizationId);
  const timeZone = rules.timeZone;
  const [
    active_clients,
    open_tasks,
    meetings_today,
    pending_docs,
    new_clients_this_month,
    unread_alerts,
  ] = await Promise.all([
    countActiveClients(organizationId),
    countOpenTasks(organizationId),
    countMeetingsToday(organizationId, now, timeZone),
    countPendingDocumentReviews(organizationId),
    countNewClientsThisMonth(organizationId),
    countUnreadAlerts(organizationId),
  ]);
  return {
    active_clients,
    open_tasks,
    meetings_today,
    pending_docs,
    new_clients_this_month,
    unread_alerts,
  };
}

export async function getDashboardHomeMetrics(
  organizationId: string,
  now: Date = new Date()
): Promise<DashboardHomeMetricsPayload> {
  const rules = await getCalendarRulesForOrganization(organizationId);
  const metrics = await countDashboardHomeMetricsDirect(organizationId, now);
  return {
    organizationId,
    computedAt: now.toISOString(),
    timeZone: rules.timeZone,
    metrics,
    definitions: { ...DASHBOARD_HOME_METRIC_DEFINITIONS },
  };
}
