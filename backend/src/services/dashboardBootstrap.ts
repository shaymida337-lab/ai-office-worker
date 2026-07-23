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
import {
  dashboardBootstrapCacheKey,
  getDashboardBootstrapCacheGeneration,
  getDashboardBootstrapInflight,
  peekDashboardBootstrapCache,
  setDashboardBootstrapCache,
  setDashboardBootstrapInflight,
  type DashboardBootstrapCacheSource,
} from "./dashboardBootstrapCache.js";

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
  settingsWallMs: number;
  homeMetricsWallMs: number;
  gmailTasksWallMs: number;
  queryWaitMs: number;
  mapMs: number;
  serializeMs: number;
  totalMs: number;
  queryGroupCount: number;
  organizationLookupCount: number;
  dbRoundTripsEstimate: number;
};

export type GetDashboardBootstrapOptions = {
  collectTiming?: boolean;
  onTiming?: (timing: DashboardBootstrapTiming) => void;
  now?: Date;
};

export type DashboardBootstrapCachedResult = {
  payload: DashboardBootstrapPayload;
  cacheSource: DashboardBootstrapCacheSource;
  cacheAgeMs: number | null;
  buildMs: number;
  timing: DashboardBootstrapTiming | null;
};

async function timedMs<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

/**
 * Single Organization identity load for bootstrap: settings fields + calendar flags.
 * One Prisma findUnique (no second raw SQL round-trip).
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
      businessType: true,
      enabledModules: true,
      businessSize: true,
      mainBusinessPain: true,
      onboardingCompleted: true,
      calendarEngineReadEnabled: true,
      calendarEngineWriteEnabled: true,
      calendarEngineGoogleMirrorEnabled: true,
    },
  });
  if (!organization) throw new Error("Organization not found");

  const businessType = normalizeBusinessType(organization.businessType);
  const businessSize = normalizeBusinessSize(organization.businessSize);
  const mainBusinessPain = normalizeBusinessPain(organization.mainBusinessPain);
  const enabledModules = normalizeEnabledModules(
    organization.enabledModules,
    businessType,
    businessSize,
    mainBusinessPain
  );

  const {
    calendarEngineReadEnabled,
    calendarEngineWriteEnabled,
    calendarEngineGoogleMirrorEnabled,
    businessType: _bt,
    enabledModules: _em,
    businessSize: _bs,
    mainBusinessPain: _mp,
    onboardingCompleted,
    ...settingsBase
  } = organization;

  const settings: OrganizationSettings = {
    ...settingsBase,
    businessType,
    businessSize,
    mainBusinessPain,
    enabledModules,
    onboardingCompleted: onboardingCompleted ?? true,
    onboardingRequired: !(onboardingCompleted ?? true),
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
  const waveA0 = performance.now();
  const orgTimedP = collect
    ? timedMs(() => loadBootstrapOrganization(organizationId))
    : loadBootstrapOrganization(organizationId).then((value) => ({ value, ms: 0 }));
  const contaminatedTimedP = collect
    ? timedMs(() => loadCrossOrgContaminatedGmailIdsForReads())
    : loadCrossOrgContaminatedGmailIdsForReads().then((value) => ({ value, ms: 0 }));
  const [orgTimed, contaminatedTimed] = await Promise.all([orgTimedP, contaminatedTimedP]);
  const settingsWallMs = Math.round(performance.now() - waveA0);
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
  const waveC0 = performance.now();
  const gmailTimedP = collect
    ? timedMs(() => resolveGmailBootstrapStatusFromDb(organizationId))
    : resolveGmailBootstrapStatusFromDb(organizationId).then((value) => ({ value, ms: 0 }));
  const tasksTimedP = collect
    ? timedMs(() => loadDashboardTasksPreview(organizationId))
    : loadDashboardTasksPreview(organizationId).then((value) => ({ value, ms: 0 }));
  const [gmailTimed, tasksTimed] = await Promise.all([gmailTimedP, tasksTimedP]);
  const gmailTasksWallMs = Math.round(performance.now() - waveC0);

  const mapT0 = performance.now();
  const displayName =
    (typeof settings.businessName === "string" && settings.businessName.trim()) ||
    (typeof settings.name === "string" && settings.name.trim()) ||
    "העסק שלי";
  const mapMs = Math.round(performance.now() - mapT0);

  const serializeT0 = performance.now();
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
  const totalMs = Math.round(performance.now() - totalT0);
  const queryWaitMs = Math.max(
    0,
    totalMs - settingsWallMs - metricsWaveMs - gmailTasksWallMs - mapMs - serializeMs
  );

  if (collect) {
    const timing: DashboardBootstrapTiming = {
      organizationSettingsMs: orgTimed.ms,
      contaminatedMs: contaminatedTimed.ms,
      metricsWaveMs,
      gmailStatusMs: gmailTimed.ms,
      tasksPreviewMs: tasksTimed.ms,
      settingsWallMs,
      homeMetricsWallMs: metricsWaveMs,
      gmailTasksWallMs,
      queryWaitMs,
      mapMs,
      serializeMs,
      totalMs,
      queryGroupCount: 5,
      organizationLookupCount: 1,
      // Wave A: 1 org + contaminated; Wave B: ≤5 counts; Wave C: ≤3 gmail + 1 tasks
      dbRoundTripsEstimate: 1 + 1 + 5 + 3 + 1,
    };
    options?.onTiming?.(timing);
  }

  return payload;
}

/**
 * Process-local fresh/stale/inflight cache over getDashboardBootstrap.
 * Key: userId + organizationId only.
 *
 * Refresh uses a separate inflight key so a failing background refresh can never
 * poison concurrent miss rebuilds (mobile often overlaps stale+miss).
 */
function dashboardBootstrapRefreshInflightKey(cacheKey: string): string {
  return `refresh\u0000${cacheKey}`;
}

export async function getDashboardBootstrapCached(input: {
  userId: string;
  organizationId: string;
  collectTiming?: boolean;
  now?: Date;
  /** When true, skip cache (tests). */
  bypassCache?: boolean;
}): Promise<DashboardBootstrapCachedResult> {
  const { userId, organizationId } = input;
  if (input.bypassCache) {
    let timing: DashboardBootstrapTiming | null = null;
    const buildT0 = performance.now();
    const payload = await getDashboardBootstrap(organizationId, {
      collectTiming: input.collectTiming,
      now: input.now,
      onTiming: (t) => {
        timing = t;
      },
    });
    return {
      payload,
      cacheSource: "bypass",
      cacheAgeMs: null,
      buildMs: Math.round(performance.now() - buildT0),
      timing,
    };
  }

  const key = dashboardBootstrapCacheKey(userId, organizationId);
  const peeked = peekDashboardBootstrapCache(userId, organizationId);
  if (peeked?.freshness === "fresh") {
    return {
      payload: peeked.entry.payload,
      cacheSource: "hit",
      cacheAgeMs: Math.max(0, Date.now() - peeked.entry.loadedAt),
      buildMs: 0,
      timing: null,
    };
  }

  if (peeked?.freshness === "stale") {
    scheduleDashboardBootstrapRefresh({ userId, organizationId, now: input.now });
    return {
      payload: peeked.entry.payload,
      cacheSource: "stale",
      cacheAgeMs: Math.max(0, Date.now() - peeked.entry.loadedAt),
      buildMs: 0,
      timing: null,
    };
  }

  const existing = getDashboardBootstrapInflight<DashboardBootstrapCachedResult>(key);
  if (existing) {
    try {
      const shared = await existing;
      return {
        ...shared,
        cacheSource: shared.cacheSource === "miss" ? "inflight" : shared.cacheSource,
      };
    } catch {
      // Rejected miss must not permanently poison the key — fall through to rebuild.
    }
  }

  const buildPromise = setDashboardBootstrapInflight(
    key,
    (async (): Promise<DashboardBootstrapCachedResult> => {
      const generationAtStart = getDashboardBootstrapCacheGeneration(userId, organizationId);
      let timing: DashboardBootstrapTiming | null = null;
      const buildT0 = performance.now();
      const payload = await getDashboardBootstrap(organizationId, {
        collectTiming: input.collectTiming,
        now: input.now,
        onTiming: (t) => {
          timing = t;
        },
      });
      const buildMs = Math.round(performance.now() - buildT0);
      assertDashboardBootstrapPayloadBounds(payload);
      setDashboardBootstrapCache({ userId, organizationId, payload, generationAtStart });
      return {
        payload,
        cacheSource: "miss",
        cacheAgeMs: null,
        buildMs,
        timing,
      };
    })()
  );

  return buildPromise;
}

function scheduleDashboardBootstrapRefresh(input: {
  userId: string;
  organizationId: string;
  now?: Date;
}): void {
  const key = dashboardBootstrapCacheKey(input.userId, input.organizationId);
  const refreshKey = dashboardBootstrapRefreshInflightKey(key);
  // Do not share the miss inflight key — refresh failures must stay isolated.
  if (getDashboardBootstrapInflight(refreshKey)) return;

  const generationAtStart = getDashboardBootstrapCacheGeneration(input.userId, input.organizationId);
  void setDashboardBootstrapInflight(
    refreshKey,
    (async () => {
      try {
        const payload = await getDashboardBootstrap(input.organizationId, { now: input.now });
        assertDashboardBootstrapPayloadBounds(payload);
        setDashboardBootstrapCache({
          userId: input.userId,
          organizationId: input.organizationId,
          payload,
          generationAtStart,
        });
        return true;
      } catch {
        // Keep whatever stale entry remains. Never throw — refresh is best-effort.
        return false;
      }
    })()
  );
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

/** Map internal build/cache failures to safe client-facing status + code (no PII). */
export function classifyDashboardBootstrapFailure(raw: string): {
  status: number;
  error: string;
  code: string;
} {
  if (/Organization not found/i.test(raw)) {
    return { status: 404, error: "Organization not found", code: "ORG_NOT_FOUND" };
  }
  if (/payload .* exceeds/i.test(raw) || /tasksPreview length/i.test(raw)) {
    return {
      status: 500,
      error: "Dashboard bootstrap payload too large",
      code: "BOOTSTRAP_PAYLOAD_TOO_LARGE",
    };
  }
  if (/Unauthorized/i.test(raw)) {
    return { status: 401, error: "Unauthorized", code: "UNAUTHORIZED" };
  }
  if (/Forbidden/i.test(raw)) {
    return { status: 403, error: "Forbidden", code: "FORBIDDEN" };
  }
  return {
    status: 500,
    error: "Failed to load dashboard bootstrap",
    code: "BOOTSTRAP_BUILD_FAILED",
  };
}

/** Test helper: list of source strings that must not appear in this module's Google-free path. */
export const DASHBOARD_BOOTSTRAP_FORBIDDEN_IMPORT_MARKERS = [
  "ensureGmailAccessToken",
  "googleapis",
  "resolveGmailConnectionStatus",
] as const;

export {
  invalidateDashboardBootstrap,
  safeInvalidateDashboardBootstrap,
} from "./dashboardBootstrapCache.js";
