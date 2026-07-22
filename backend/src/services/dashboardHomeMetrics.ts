import { prisma } from "../lib/prisma.js";
import { getDayBounds } from "./calendar/datetime.js";
import { DEFAULT_TIMEZONE } from "./calendar/rules.js";
import {
  resolveCalendarEngineFlags,
  resolveCalendarEngineFlagsFromOrg,
  type ResolvedCalendarEngineFlags,
} from "./calendar/calendarEngineFlags.js";
import { countCrmActiveAndNewLeads, countCrmActiveCustomers, countCrmNewLeads } from "./crm/crmCounts.js";
import {
  buildDocumentReviewsListWhere,
  countDocumentReviewsForStatus,
} from "./documentReviewsHomeSummary.js";
import { loadCrossOrgContaminatedGmailIdsForReads } from "./p0/financialReadIsolation.js";

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

/** Dev/test-only stage timings (ms). Enabled via options.collectTiming or env. */
export type DashboardHomeMetricsTiming = {
  organizationResolvedMs: number;
  contaminatedResolvedMs: number;
  active_clientsMs: number;
  open_tasksMs: number;
  meetings_todayMs: number;
  pending_docsMs: number;
  new_clients_this_monthMs: number;
  unread_alertsMs: number;
  countersWaveMs: number;
  totalMs: number;
  queryCountEstimate: number;
};

export type GetDashboardHomeMetricsOptions = {
  /** When true (or DASHBOARD_HOME_METRICS_TIMING=1), attach timings for diagnostics. */
  collectTiming?: boolean;
  onTiming?: (timing: DashboardHomeMetricsTiming) => void;
};

function timingEnabled(options?: GetDashboardHomeMetricsOptions): boolean {
  if (options?.collectTiming) return true;
  if (options?.onTiming) return true;
  return process.env.DASHBOARD_HOME_METRICS_TIMING === "1";
}

async function timedMs<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

export async function countActiveClients(organizationId: string): Promise<number> {
  // Dashboard “מבוטחים/לקוחות פעילים” must match CRM KPI — Lead open pipeline.
  return countCrmActiveCustomers(organizationId);
}

export async function countOpenTasks(organizationId: string): Promise<number> {
  return prisma.task.count({
    where: { organizationId, status: "open" },
  });
}

/**
 * pending_docs with the same isolation semantics as document-reviews reads
 * (loadCrossOrgContaminatedGmailIdsForReads + org-scoped count — no findMany list).
 */
export async function countPendingDocumentReviews(
  organizationId: string,
  contaminatedGmailIds?: string[],
): Promise<number> {
  return countDocumentReviewsForStatus({
    organizationId,
    status: "needs_review",
    contaminatedGmailIds,
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
  timeZone: string,
  flags?: ResolvedCalendarEngineFlags,
): Promise<number> {
  const { start, end } = getDayBounds(now, timeZone);
  const resolved = flags ?? (await resolveCalendarEngineFlags(organizationId));

  const appointmentCountPromise = prisma.appointment.count({
    where: {
      organizationId,
      startTime: { gte: start, lt: end },
      status: { not: "cancelled" },
    },
  });

  if (!resolved.readEnabled) {
    return appointmentCountPromise;
  }

  const [appointmentCount, calendarEventCount] = await Promise.all([
    appointmentCountPromise,
    prisma.calendarEvent.count({
      where: {
        organizationId,
        startAt: { gte: start, lt: end },
        status: { not: "cancelled" },
      },
    }),
  ]);

  return appointmentCount + calendarEventCount;
}

async function loadHomeMetricsOrganization(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      timezone: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
    },
  });
}

/** Direct prisma counts — used by tests to verify API payload matches DB truth. */
export async function countDashboardHomeMetricsDirect(
  organizationId: string,
  now: Date = new Date(),
): Promise<Record<DashboardHomeMetricId, number>> {
  const payload = await getDashboardHomeMetrics(organizationId, now);
  return payload.metrics;
}

export async function getDashboardHomeMetrics(
  organizationId: string,
  now: Date = new Date(),
  options?: GetDashboardHomeMetricsOptions,
): Promise<DashboardHomeMetricsPayload> {
  const collect = timingEnabled(options);
  const totalT0 = performance.now();

  // Wave 1: one org round-trip + contaminated IDs (cached 30s) in parallel.
  const orgTimed = collect
    ? timedMs(() => loadHomeMetricsOrganization(organizationId))
    : loadHomeMetricsOrganization(organizationId).then((value) => ({ value, ms: 0 }));
  const contaminatedTimed = collect
    ? timedMs(() => loadCrossOrgContaminatedGmailIdsForReads())
    : loadCrossOrgContaminatedGmailIdsForReads().then((value) => ({ value, ms: 0 }));

  const [orgResult, contaminatedResult] = await Promise.all([orgTimed, contaminatedTimed]);
  const org = orgResult.value;
  const contaminatedGmailIds = contaminatedResult.value;
  const timeZone = org?.timezone?.trim() || DEFAULT_TIMEZONE;
  const flags = resolveCalendarEngineFlagsFromOrg(org);

  const countersT0 = performance.now();

  // Wave 2: ≤5 concurrent counts so we fit typical Prisma connection_limit=5.
  // Lead active+new share one SQL; meetings is 1 query when calendar read is off.
  const runCounter = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    if (!collect) {
      return { value: await fn(), ms: 0 };
    }
    return timedMs(fn);
  };

  const [
    leadPairResult,
    openTasksResult,
    meetingsResult,
    pendingDocsResult,
    unreadAlertsResult,
  ] = await Promise.all([
    runCounter(() => countCrmActiveAndNewLeads(organizationId)),
    runCounter(() => countOpenTasks(organizationId)),
    runCounter(() => countMeetingsToday(organizationId, now, timeZone, flags)),
    runCounter(() => countPendingDocumentReviews(organizationId, contaminatedGmailIds)),
    runCounter(() => countUnreadAlerts(organizationId)),
  ]);

  const metrics: Record<DashboardHomeMetricId, number> = {
    active_clients: leadPairResult.value.activeCustomers,
    open_tasks: openTasksResult.value,
    meetings_today: meetingsResult.value,
    pending_docs: pendingDocsResult.value,
    new_clients_this_month: leadPairResult.value.newLeads,
    unread_alerts: unreadAlertsResult.value,
  };

  // Estimate: org + contaminated + lead-pair + task + meetings(+maybe event) + pending + alerts.
  const meetingsExtra = flags.readEnabled ? 1 : 0;
  const queryCountEstimate = 2 + 5 + meetingsExtra;

  if (collect) {
    const timing: DashboardHomeMetricsTiming = {
      organizationResolvedMs: orgResult.ms,
      contaminatedResolvedMs: contaminatedResult.ms,
      active_clientsMs: leadPairResult.ms,
      open_tasksMs: openTasksResult.ms,
      meetings_todayMs: meetingsResult.ms,
      pending_docsMs: pendingDocsResult.ms,
      new_clients_this_monthMs: leadPairResult.ms,
      unread_alertsMs: unreadAlertsResult.ms,
      countersWaveMs: Math.round(performance.now() - countersT0),
      totalMs: Math.round(performance.now() - totalT0),
      queryCountEstimate,
    };
    options?.onTiming?.(timing);
    if (process.env.DASHBOARD_HOME_METRICS_TIMING === "1") {
      console.info("[dashboard/home-metrics timing]", JSON.stringify(timing));
    }
  }

  return {
    organizationId,
    computedAt: now.toISOString(),
    timeZone,
    metrics,
    definitions: { ...DASHBOARD_HOME_METRIC_DEFINITIONS },
  };
}

/** Test helper: assert pending_docs where matches document-reviews list policy. */
export function buildPendingDocsWhereForTests(
  organizationId: string,
  contaminatedGmailIds: string[],
) {
  return buildDocumentReviewsListWhere(organizationId, "needs_review", contaminatedGmailIds);
}
