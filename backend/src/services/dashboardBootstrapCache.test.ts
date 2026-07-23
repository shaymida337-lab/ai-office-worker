import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import {
  assertDashboardBootstrapPayloadBounds,
  getDashboardBootstrap,
  getDashboardBootstrapCached,
} from "./dashboardBootstrap.js";
import {
  ageDashboardBootstrapCacheForTests,
  dashboardBootstrapCacheSizeForTests,
  DASHBOARD_BOOTSTRAP_SERVER_FRESH_TTL_MS,
  getDashboardBootstrapCacheGeneration,
  invalidateDashboardBootstrap,
  resetDashboardBootstrapCacheForTests,
  setDashboardBootstrapCache,
} from "./dashboardBootstrapCache.js";
import {
  buildDashboardBootstrapServerTiming,
  computeUnaccountedMs,
  type DashboardBootstrapEndpointTiming,
} from "../lib/dashboardBootstrapServerTiming.js";
import { resetCrossOrgContaminatedGmailIdsCacheForTests } from "./p0/financialReadIsolation.js";

const USER = "user-bootstrap-cache";
const USER_B = "user-bootstrap-cache-b";
const ORG = "org-bootstrap-cache";
const ORG_B = "org-bootstrap-cache-b";
const NOW = new Date("2026-07-15T10:00:00.000Z");

function installMocks(options?: { failAlerts?: boolean; alerts?: number }) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    taskCount: prisma.task.count.bind(prisma.task),
    taskFindMany: prisma.task.findMany.bind(prisma.task),
    appointmentCount: prisma.appointment.count.bind(prisma.appointment),
    calendarEventCount: prisma.calendarEvent.count.bind(prisma.calendarEvent),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
    alertCount: prisma.alert.count.bind(prisma.alert),
    integrationFindUnique: prisma.integration.findUnique.bind(prisma.integration),
    syncLogFindFirst: prisma.syncLog.findFirst.bind(prisma.syncLog),
  };

  let orgLookups = 0;
  let buildCalls = 0;
  resetCrossOrgContaminatedGmailIdsCacheForTests();

  prisma.organization.findUnique = (async () => {
    orgLookups += 1;
    buildCalls += 1;
    return {
      id: ORG,
      name: "Org",
      businessName: "Org",
      locale: "he-IL",
      language: "he",
      country: "IL",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      dateFormat: "dd/MM/yyyy",
      timeFormat: "24h",
      weekStart: "sunday",
      phoneCountryCode: "IL",
      businessType: "service_business",
      enabledModules: ["crm", "tasks"],
      businessSize: "solo",
      mainBusinessPain: null,
      onboardingCompleted: true,
      calendarEngineReadEnabled: false,
      calendarEngineWriteEnabled: false,
      calendarEngineGoogleMirrorEnabled: false,
    };
  }) as typeof prisma.organization.findUnique;

  prisma.$queryRawUnsafe = (async (sql: string, ...params: unknown[]) => {
    if (typeof sql === "string" && sql.includes('FROM "Lead"') && sql.includes("FILTER")) {
      return [{ active: 1, neu: 1 }];
    }
    return [];
  }) as typeof prisma.$queryRawUnsafe;

  prisma.task.count = (async () => 2) as typeof prisma.task.count;
  prisma.task.findMany = (async () => [
    {
      id: "t1",
      title: "T1",
      supplier: null,
      priority: "normal",
      status: "open",
      dueDate: null,
      updatedAt: NOW,
      createdAt: NOW,
    },
  ]) as typeof prisma.task.findMany;
  prisma.appointment.count = (async () => 0) as typeof prisma.appointment.count;
  prisma.calendarEvent.count = (async () => 0) as typeof prisma.calendarEvent.count;
  prisma.financialDocumentReview.count = (async () => 3) as typeof prisma.financialDocumentReview.count;
  prisma.alert.count = (async () => {
    if (options?.failAlerts) throw new Error("alerts boom");
    return options?.alerts ?? 4;
  }) as typeof prisma.alert.count;
  prisma.integration.findUnique = (async () => ({
    refreshToken: "rt",
    connectedAt: NOW,
  })) as typeof prisma.integration.findUnique;
  prisma.syncLog.findFirst = (async () => null) as typeof prisma.syncLog.findFirst;

  return {
    getOrgLookups: () => orgLookups,
    getBuildCalls: () => buildCalls,
    restore() {
      prisma.organization.findUnique = originals.organizationFindUnique;
      prisma.task.count = originals.taskCount;
      prisma.task.findMany = originals.taskFindMany;
      prisma.appointment.count = originals.appointmentCount;
      prisma.calendarEvent.count = originals.calendarEventCount;
      prisma.financialDocumentReview.count = originals.fdrCount;
      prisma.$queryRawUnsafe = originals.queryRaw;
      prisma.alert.count = originals.alertCount;
      prisma.integration.findUnique = originals.integrationFindUnique;
      prisma.syncLog.findFirst = originals.syncLogFindFirst;
      resetCrossOrgContaminatedGmailIdsCacheForTests();
      resetDashboardBootstrapCacheForTests();
    },
  };
}

function basePayload(overrides?: { orgId?: string; alerts?: number }) {
  const organizationId = overrides?.orgId ?? ORG;
  return {
    organizationSettings: {
      id: organizationId,
      name: "Org",
      businessName: "Org",
      displayName: "Org",
      locale: "he-IL",
      language: "he",
      country: "IL",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      dateFormat: "dd/MM/yyyy",
      timeFormat: "24h",
      weekStart: "sunday",
      phoneCountryCode: "IL",
      businessType: "service_business",
      businessSize: "solo",
      mainBusinessPain: null,
      enabledModules: ["crm"],
      onboardingCompleted: true,
      onboardingRequired: false,
      recommendedModules: [],
      businessProfile: {},
      template: { id: "service_business" },
    },
    homeMetrics: {
      organizationId,
      computedAt: NOW.toISOString(),
      timeZone: "Asia/Jerusalem",
      metrics: {
        active_clients: 1,
        open_tasks: 2,
        meetings_today: 0,
        pending_docs: 3,
        new_clients_this_month: 1,
        unread_alerts: overrides?.alerts ?? 4,
      },
      definitions: {},
    },
    gmailStatus: {
      connected: true,
      scanning: false,
      lastScanAt: null,
      googleConfigured: false,
      connectedAt: NOW.toISOString(),
    },
    tasksPreview: [],
    generatedAt: NOW.toISOString(),
  } as Awaited<ReturnType<typeof getDashboardBootstrap>>;
}

test("fresh server cache hit → buildMs=0 and no rebuild", async () => {
  const mocks = installMocks();
  try {
    const miss = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(miss.cacheSource, "miss");
    assert.ok(miss.buildMs >= 0);
    const buildsAfterMiss = mocks.getBuildCalls();
    assert.ok(buildsAfterMiss >= 1);

    const hit = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(hit.cacheSource, "hit");
    assert.equal(hit.buildMs, 0);
    assert.equal(mocks.getBuildCalls(), buildsAfterMiss);
    assert.deepEqual(hit.payload.homeMetrics.metrics, miss.payload.homeMetrics.metrics);
  } finally {
    mocks.restore();
  }
});

test("miss → exactly one build; parallel requests share one inflight build", async () => {
  const mocks = installMocks();
  try {
    const [a, b] = await Promise.all([
      getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW }),
      getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW }),
    ]);
    assert.ok(a.cacheSource === "miss" || a.cacheSource === "inflight");
    assert.ok(b.cacheSource === "miss" || b.cacheSource === "inflight");
    assert.equal(mocks.getOrgLookups(), 1);
    assert.deepEqual(a.payload.homeMetrics.metrics, b.payload.homeMetrics.metrics);
  } finally {
    mocks.restore();
  }
});

test("stale returns data immediately and refreshes once", async () => {
  const mocks = installMocks();
  try {
    await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    const builds = mocks.getBuildCalls();
    ageDashboardBootstrapCacheForTests(USER, ORG, DASHBOARD_BOOTSTRAP_SERVER_FRESH_TTL_MS + 1);
    const stale = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(stale.cacheSource, "stale");
    assert.equal(stale.buildMs, 0);
    assert.equal(stale.payload.homeMetrics.metrics.open_tasks, 2);
    // Allow background refresh to complete.
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(mocks.getBuildCalls() >= builds + 1);
    const after = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(after.cacheSource, "hit");
  } finally {
    mocks.restore();
  }
});

test("stale refresh failure keeps stale data", async () => {
  const mocks = installMocks();
  try {
    await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    ageDashboardBootstrapCacheForTests(USER, ORG, DASHBOARD_BOOTSTRAP_SERVER_FRESH_TTL_MS + 1);
    // Next build fails
    prisma.alert.count = (async () => {
      throw new Error("alerts boom");
    }) as typeof prisma.alert.count;
    const stale = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(stale.cacheSource, "stale");
    assert.equal(stale.payload.homeMetrics.metrics.unread_alerts, 4);
    await new Promise((r) => setTimeout(r, 30));
    const still = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.ok(still.cacheSource === "stale" || still.cacheSource === "hit");
    assert.equal(still.payload.homeMetrics.metrics.unread_alerts, 4);
  } finally {
    mocks.restore();
  }
});

test("miss failure returns real error (no fake zeros)", async () => {
  const mocks = installMocks({ failAlerts: true });
  try {
    await assert.rejects(
      () => getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW }),
      /alerts boom/
    );
    assert.equal(dashboardBootstrapCacheSizeForTests(), 0);
  } finally {
    mocks.restore();
  }
});

test("rejected miss does not poison inflight; retry succeeds", async () => {
  resetDashboardBootstrapCacheForTests();
  const failing = installMocks({ failAlerts: true });
  try {
    await assert.rejects(
      () => getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW }),
      /alerts boom/
    );
  } finally {
    failing.restore();
  }
  const healthy = installMocks({ alerts: 7 });
  try {
    const again = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(again.cacheSource, "miss");
    assert.equal(again.payload.homeMetrics.metrics.unread_alerts, 7);
    const hit = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(hit.cacheSource, "hit");
  } finally {
    healthy.restore();
  }
});

test("stale refresh failure with expired entry does not reject concurrent miss rebuild", async () => {
  const mocks = installMocks();
  try {
    await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    ageDashboardBootstrapCacheForTests(USER, ORG, DASHBOARD_BOOTSTRAP_SERVER_FRESH_TTL_MS + 1);
    prisma.alert.count = (async () => {
      throw new Error("refresh boom");
    }) as typeof prisma.alert.count;
    const stale = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.equal(stale.cacheSource, "stale");
    // Expire past stale TTL while refresh is in-flight.
    ageDashboardBootstrapCacheForTests(USER, ORG, 10 * 60_000);
    // Concurrent miss must rebuild (or keep serving) without throwing from refresh stale!.
    prisma.alert.count = (async () => 9) as typeof prisma.alert.count;
    await new Promise((r) => setTimeout(r, 40));
    const rebuilt = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    assert.ok(["miss", "hit", "inflight", "stale"].includes(rebuilt.cacheSource));
    assert.ok(rebuilt.payload.homeMetrics.metrics.unread_alerts === 9 || rebuilt.payload.homeMetrics.metrics.unread_alerts === 4);
  } finally {
    mocks.restore();
  }
});

test("classifyDashboardBootstrapFailure maps clear codes", async () => {
  const { classifyDashboardBootstrapFailure } = await import("./dashboardBootstrap.js");
  assert.equal(classifyDashboardBootstrapFailure("Organization not found").code, "ORG_NOT_FOUND");
  assert.equal(classifyDashboardBootstrapFailure("bootstrap payload 99999 bytes exceeds 51200").code, "BOOTSTRAP_PAYLOAD_TOO_LARGE");
  assert.equal(classifyDashboardBootstrapFailure("alerts boom").code, "BOOTSTRAP_BUILD_FAILED");
  assert.equal(classifyDashboardBootstrapFailure("Unauthorized").status, 401);
  assert.equal(classifyDashboardBootstrapFailure("Forbidden").status, 403);
});

test("api.ts still imports dashboard bootstrap helpers (regression guard)", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../routes/api.ts"),
    "utf8"
  );
  assert.match(src, /getDashboardBootstrapCached/);
  assert.match(src, /assertDashboardBootstrapPayloadBounds/);
  assert.match(src, /classifyDashboardBootstrapFailure/);
  assert.match(src, /from \"\.\.\/services\/dashboardBootstrap\.js\"/);
  assert.match(src, /from \"\.\.\/lib\/dashboardBootstrapServerTiming\.js\"/);
});

test("user isolation and organization isolation", async () => {
  resetDashboardBootstrapCacheForTests();
  const payloadA = basePayload({ orgId: ORG, alerts: 10 });
  const payloadB = basePayload({ orgId: ORG_B, alerts: 99 });
  const genA = getDashboardBootstrapCacheGeneration(USER, ORG);
  const genB = getDashboardBootstrapCacheGeneration(USER_B, ORG_B);
  setDashboardBootstrapCache({
    userId: USER,
    organizationId: ORG,
    payload: payloadA,
    generationAtStart: genA,
  });
  setDashboardBootstrapCache({
    userId: USER_B,
    organizationId: ORG_B,
    payload: payloadB,
    generationAtStart: genB,
  });

  const a = await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
  const b = await getDashboardBootstrapCached({ userId: USER_B, organizationId: ORG_B, now: NOW });
  assert.equal(a.cacheSource, "hit");
  assert.equal(b.cacheSource, "hit");
  assert.equal(a.payload.homeMetrics.organizationId, ORG);
  assert.equal(b.payload.homeMetrics.organizationId, ORG_B);
  assert.notEqual(a.payload.homeMetrics.metrics.unread_alerts, b.payload.homeMetrics.metrics.unread_alerts);
  resetDashboardBootstrapCacheForTests();
});

test("invalidation + generation bump prevents stale repopulation", async () => {
  const mocks = installMocks();
  try {
    await getDashboardBootstrapCached({ userId: USER, organizationId: ORG, now: NOW });
    const genBefore = getDashboardBootstrapCacheGeneration(USER, ORG);
    invalidateDashboardBootstrap(undefined, ORG);
    assert.ok(getDashboardBootstrapCacheGeneration(USER, ORG) > genBefore);
    assert.equal(dashboardBootstrapCacheSizeForTests(), 0);

    // Late set with old generation must not repopulate.
    setDashboardBootstrapCache({
      userId: USER,
      organizationId: ORG,
      payload: basePayload(),
      generationAtStart: genBefore,
    });
    assert.equal(dashboardBootstrapCacheSizeForTests(), 0);
  } finally {
    mocks.restore();
  }
});

test("invalidation wiring present for home-affecting mutations", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    "services/crm.ts",
    "services/tasks.ts",
    "services/appointmentService.ts",
    "services/businessTemplates.ts",
    "services/financialDocuments.ts",
    "services/gmailScanLifecycle.ts",
    "services/rbac/membership.ts",
    "routes/membershipRoutes.ts",
    "routes/integrations.ts",
    "routes/api.ts",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    assert.match(src, /safeInvalidateDashboardBootstrap|invalidateDashboardBootstrap/, rel);
  }
});

test("Server-Timing unaccounted <50ms for hit-shaped timing", () => {
  const base: Omit<DashboardBootstrapEndpointTiming, "unaccountedMs"> = {
    preRouteMs: 0,
    authMs: 2,
    tenantMs: 1,
    tenantDbMs: 0,
    organizationResolutionMs: 0,
    settingsMs: 0,
    homeMetricsMs: 0,
    gmailStatusMs: 0,
    tasksMs: 0,
    queryWaitMs: 0,
    mapMs: 0,
    serializeMs: 1,
    responseMs: 0,
    middlewareMs: 1,
    totalMs: 5,
    tenantDbRoundTrips: 0,
    orgLookupCount: 0,
    bootstrapCacheSource: "hit",
    bootstrapCacheAgeMs: 10,
    bootstrapBuildMs: 0,
  };
  const unaccounted = computeUnaccountedMs(base);
  assert.ok(unaccounted < 50, `unaccounted=${unaccounted}`);
  const header = buildDashboardBootstrapServerTiming({ ...base, unaccountedMs: unaccounted });
  assert.match(header, /tenant_db;dur=0/);
  assert.match(header, /total;dur=5/);
  assert.doesNotMatch(header, /eyJ|Bearer|@|token/i);
});

test("payload bounds and no Google API in bootstrap module", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, "dashboardBootstrap.ts"), "utf8");
  const importBlock = src.split("export const DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT")[0] ?? src;
  assert.doesNotMatch(importBlock, /ensureGmailAccessToken|googleapis|resolveGmailConnectionStatus/);
  const payload = basePayload();
  assertDashboardBootstrapPayloadBounds(payload as never);
});
