/**
 * Dashboard home First Paint bootstrap — one authenticated round-trip.
 * No Google API, no financial stats, no document-reviews list, no unbounded findMany.
 */
import { hasGoogleOAuth } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { DEFAULT_TIMEZONE } from "./calendar/rules.js";
import {
  resolveCalendarEngineFlagsFromOrg,
  type CalendarEngineOrgFlagsRow,
} from "./calendar/calendarEngineFlags.js";
import {
  BUSINESS_TEMPLATES,
  buildBusinessProfile,
  getOrganizationSettings,
  normalizeBusinessPain,
  normalizeBusinessSize,
  normalizeBusinessType,
  normalizeEnabledModules,
  recommendedModulesFor,
} from "./businessTemplates.js";
import { countCrmActiveAndNewLeads } from "./crm/crmCounts.js";
import {
  countMeetingsToday,
  countOpenTasks,
  countPendingDocumentReviews,
  countUnreadAlerts,
  DASHBOARD_HOME_METRIC_DEFINITIONS,
  type DashboardHomeMetricId,
  type DashboardHomeMetricsPayload,
} from "./dashboardHomeMetrics.js";
import { findActiveGmailScanLog } from "./gmailScanLifecycle.js";
import { loadCrossOrgContaminatedGmailIdsForReads } from "./p0/financialReadIsolation.js";

export const DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT = 8;
export const DASHBOARD_BOOTSTRAP_MAX_PAYLOAD_BYTES = 50 * 1024;

export type DashboardBootstrapGmailStatus = {
  connected: boolean;
  scanning: boolean;
  lastScanAt: string | null;
  googleConfigured: boolean;
  connectedAt: string | null;
};

export type DashboardBootstrapTaskPreview = {
  id: string;
  title: string;
  supplier: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
  updatedAt: string;
};

type OrganizationSettings = Awaited<ReturnType<typeof getOrganizationSettings>>;

export type DashboardBootstrapPayload = {
  organizationSettings: OrganizationSettings & { displayName: string };
  homeMetrics: DashboardHomeMetricsPayload;
  gmailStatus: DashboardBootstrapGmailStatus;
  tasksPreview: DashboardBootstrapTaskPreview[];
  generatedAt: string;
};

export type DashboardBootstrapTiming = {
  organizationSettingsMs: number;
  contaminatedMs: number;
  metricsWaveMs: number;
  gmailStatusMs: number;
  tasksPreviewMs: number;
  serializeMs: number;
  totalMs: number;
  queryGroupCount: number;
  organizationLookupCount: number;
};

export type GetDashboardBootstrapOptions = {
  collectTiming?: boolean;
  onTiming?: (timing: DashboardBootstrapTiming) => void;
  now?: Date;
};

async function timedMs<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

/**
 * Single Organization identity load for bootstrap: settings fields + calendar flags.
 * Mirrors getOrganizationSettings assembly so UI contract stays identical.
 */
async function loadBootstrapOrganization(organizationId: string): Promise<{
  settings: OrganizationSettings;
  calendarFlags: CalendarEngineOrgFlagsRow;
}> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      businessName: true,
      locale: true,
      language: true,
      country: true,
      currency: true,
      timezone: true,
      dateFormat: true,
      timeFormat: true,
      weekStart: true,
      phoneCountryCode: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
    },
  });
  if (!organization) throw new Error("Organization not found");

  const configRows = await prisma
    .$queryRawUnsafe<
      Array<{
        business_type: string | null;
        enabled_modules: unknown;
        business_size: string | null;
        main_business_pain: string | null;
        onboarding_completed: boolean | null;
      }>
    >(
      'SELECT "business_type", "enabled_modules", "business_size", "main_business_pain", "onboarding_completed" FROM "Organization" WHERE "id" = $1 LIMIT 1',
      organizationId
    )
    .catch(() => []);

  const businessType = normalizeBusinessType(configRows[0]?.business_type);
  const businessSize = normalizeBusinessSize(configRows[0]?.business_size);
  const mainBusinessPain = normalizeBusinessPain(configRows[0]?.main_business_pain);
  const enabledModules = normalizeEnabledModules(
    configRows[0]?.enabled_modules,
    businessType,
    businessSize,
    mainBusinessPain
  );

  const {
    calendarEngineReadEnabled,
    calendarEngineWriteEnabled,
    calendarEngineGoogleMirrorEnabled,
    ...settingsBase
  } = organization;

  const settings: OrganizationSettings = {
    ...settingsBase,
    businessType,
    businessSize,
    mainBusinessPain,
    enabledModules,
    onboardingCompleted: configRows[0]?.onboarding_completed ?? true,
    onboardingRequired: !(configRows[0]?.onboarding_completed ?? true),
    recommendedModules: recommendedModulesFor(businessType, businessSize, mainBusinessPain),
    businessProfile: buildBusinessProfile(businessType),
    template: BUSINESS_TEMPLATES.find((template) => template.id === businessType) ?? BUSINESS_TEMPLATES[7],
  };

  return {
    settings,
    calendarFlags: {
      calendarEngineReadEnabled,
      calendarEngineWriteEnabled,
      calendarEngineGoogleMirrorEnabled,
    },
  };
}

/** DB-only Gmail connection + scan flags — never calls Google. */
export async function resolveGmailBootstrapStatusFromDb(
  organizationId: string
): Promise<DashboardBootstrapGmailStatus> {
  const [integration, activeScan, lastSuccess] = await Promise.all([
    prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: "gmail" } },
      select: { refreshToken: true, connectedAt: true },
    }),
    findActiveGmailScanLog(organizationId),
    prisma.syncLog.findFirst({
      where: { organizationId, type: "gmail_scan", status: "success" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  return {
    connected: Boolean(integration?.refreshToken),
    scanning: Boolean(activeScan),
    lastScanAt: lastSuccess?.finishedAt ? lastSuccess.finishedAt.toISOString() : null,
    googleConfigured: hasGoogleOAuth(),
    connectedAt: integration?.connectedAt ? integration.connectedAt.toISOString() : null,
  };
}

export async function loadDashboardTasksPreview(
  organizationId: string,
  take = DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT
): Promise<DashboardBootstrapTaskPreview[]> {
  const tasks = await prisma.task.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      title: true,
      supplier: true,
      priority: true,
      status: true,
      dueDate: true,
      updatedAt: true,
    },
  });
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    supplier: task.supplier,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    updatedAt: task.updatedAt.toISOString(),
  }));
}

/**
 * Query groups (≤5), concurrency bounded to Prisma pool (~5):
 * Wave A: organization settings ∥ contaminated ids (same as home-metrics)
 * Wave B: ≤5 metric counters
 * Wave C: gmail DB status ∥ tasks preview (pool free after counters)
 */
export async function getDashboardBootstrap(
  organizationId: string,
  options?: GetDashboardBootstrapOptions
): Promise<DashboardBootstrapPayload> {
  const now = options?.now ?? new Date();
  const collect = Boolean(options?.collectTiming || options?.onTiming);
  const totalT0 = performance.now();

  // Wave A — org once ∥ contaminated (≤2 significant groups, pool-safe)
  const orgTimedP = collect
    ? timedMs(() => loadBootstrapOrganization(organizationId))
    : loadBootstrapOrganization(organizationId).then((value) => ({ value, ms: 0 }));
  const contaminatedTimedP = collect
    ? timedMs(() => loadCrossOrgContaminatedGmailIdsForReads())
    : loadCrossOrgContaminatedGmailIdsForReads().then((value) => ({ value, ms: 0 }));
  const [orgTimed, contaminatedTimed] = await Promise.all([orgTimedP, contaminatedTimedP]);
  const { settings, calendarFlags } = orgTimed.value;
  const contaminatedGmailIds = contaminatedTimed.value;
  const timeZone = settings.timezone?.trim() || DEFAULT_TIMEZONE;
  const meetingFlags = resolveCalendarEngineFlagsFromOrg(calendarFlags);

  // Wave B — ≤5 metric counters (same business logic as home-metrics)
  const metricsT0 = performance.now();
  const [leadPair, openTasks, meetingsToday, pendingDocs, unreadAlerts] = await Promise.all([
    countCrmActiveAndNewLeads(organizationId),
    countOpenTasks(organizationId),
    countMeetingsToday(organizationId, now, timeZone, meetingFlags),
    countPendingDocumentReviews(organizationId, contaminatedGmailIds),
    countUnreadAlerts(organizationId),
  ]);
  const metricsWaveMs = Math.round(performance.now() - metricsT0);

  const metrics: Record<DashboardHomeMetricId, number> = {
    active_clients: leadPair.activeCustomers,
    open_tasks: openTasks,
    meetings_today: meetingsToday,
    pending_docs: pendingDocs,
    new_clients_this_month: leadPair.newLeads,
    unread_alerts: unreadAlerts,
  };

  // Wave C — gmail ∥ tasks after counters release pool slots (gmail uses ≤3 internal queries)
  const gmailTimedP = collect
    ? timedMs(() => resolveGmailBootstrapStatusFromDb(organizationId))
    : resolveGmailBootstrapStatusFromDb(organizationId).then((value) => ({ value, ms: 0 }));
  const tasksTimedP = collect
    ? timedMs(() => loadDashboardTasksPreview(organizationId))
    : loadDashboardTasksPreview(organizationId).then((value) => ({ value, ms: 0 }));
  const [gmailTimed, tasksTimed] = await Promise.all([gmailTimedP, tasksTimedP]);
  const serializeT0 = performance.now();
  const displayName =
    (typeof settings.businessName === "string" && settings.businessName.trim()) ||
    (typeof settings.name === "string" && settings.name.trim()) ||
    "העסק שלי";

  const payload: DashboardBootstrapPayload = {
    organizationSettings: {
      ...settings,
      displayName,
    },
    homeMetrics: {
      organizationId,
      computedAt: now.toISOString(),
      timeZone,
      metrics,
      definitions: { ...DASHBOARD_HOME_METRIC_DEFINITIONS },
    },
    gmailStatus: gmailTimed.value,
    tasksPreview: tasksTimed.value,
    generatedAt: now.toISOString(),
  };
  const serializeMs = Math.round(performance.now() - serializeT0);

  if (collect) {
    const timing: DashboardBootstrapTiming = {
      organizationSettingsMs: orgTimed.ms,
      contaminatedMs: contaminatedTimed.ms,
      metricsWaveMs,
      gmailStatusMs: gmailTimed.ms,
      tasksPreviewMs: tasksTimed.ms,
      serializeMs,
      totalMs: Math.round(performance.now() - totalT0),
      queryGroupCount: 5,
      organizationLookupCount: 1,
    };
    options?.onTiming?.(timing);
    if (process.env.DASHBOARD_BOOTSTRAP_TIMING === "1") {
      console.info("[dashboard/bootstrap timing]", JSON.stringify(timing));
    }
  }

  return payload;
}

export function assertDashboardBootstrapPayloadBounds(payload: DashboardBootstrapPayload): void {
  if (payload.tasksPreview.length > DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT) {
    throw new Error(
      `tasksPreview length ${payload.tasksPreview.length} exceeds ${DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT}`
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > DASHBOARD_BOOTSTRAP_MAX_PAYLOAD_BYTES) {
    throw new Error(`bootstrap payload ${bytes} bytes exceeds ${DASHBOARD_BOOTSTRAP_MAX_PAYLOAD_BYTES}`);
  }
}

/** Test helper: list of source strings that must not appear in this module's Google-free path. */
export const DASHBOARD_BOOTSTRAP_FORBIDDEN_IMPORT_MARKERS = [
  "ensureGmailAccessToken",
  "googleapis",
  "resolveGmailConnectionStatus",
] as const;
