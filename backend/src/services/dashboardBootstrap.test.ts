import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import {
  assertDashboardBootstrapPayloadBounds,
  DASHBOARD_BOOTSTRAP_FORBIDDEN_IMPORT_MARKERS,
  DASHBOARD_BOOTSTRAP_MAX_PAYLOAD_BYTES,
  DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT,
  getDashboardBootstrap,
} from "./dashboardBootstrap.js";
import { getDashboardHomeMetrics } from "./dashboardHomeMetrics.js";
import { resetCrossOrgContaminatedGmailIdsCacheForTests } from "./p0/financialReadIsolation.js";

const ORG = "org-bootstrap-test";
const ORG_OTHER = "org-bootstrap-other";
const NOW = new Date("2026-07-15T10:00:00.000Z");

function installBootstrapMocks(options?: {
  leadActive?: number;
  leadNew?: number;
  tasks?: number;
  appointments?: number;
  pendingDocs?: number;
  alerts?: number;
  taskRows?: number;
  failAlerts?: boolean;
  connected?: boolean;
  scanning?: boolean;
}) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    taskCount: prisma.task.count.bind(prisma.task),
    taskFindMany: prisma.task.findMany.bind(prisma.task),
    appointmentCount: prisma.appointment.count.bind(prisma.appointment),
    calendarEventCount: prisma.calendarEvent.count.bind(prisma.calendarEvent),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    fdrFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
    alertCount: prisma.alert.count.bind(prisma.alert),
    integrationFindUnique: prisma.integration.findUnique.bind(prisma.integration),
    syncLogFindFirst: prisma.syncLog.findFirst.bind(prisma.syncLog),
  };

  let orgLookups = 0;
  let fdrFindManyCalls = 0;
  let maxParallel = 0;
  let inFlight = 0;
  const bump = async <T>(fn: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    maxParallel = Math.max(maxParallel, inFlight);
    try {
      return await fn();
    } finally {
      inFlight -= 1;
    }
  };

  resetCrossOrgContaminatedGmailIdsCacheForTests();

  prisma.organization.findUnique = (async () => {
    orgLookups += 1;
    return {
      id: ORG,
      name: "שי",
      businessName: "שי",
      locale: "he-IL",
      language: "he",
      country: "IL",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      dateFormat: "dd/MM/yyyy",
      timeFormat: "24h",
      weekStart: "sunday",
      phoneCountryCode: "IL",
      businessType: "insurance_agency",
      enabledModules: ["crm", "tasks"],
      businessSize: "solo",
      mainBusinessPain: "leads",
      onboardingCompleted: true,
      calendarEngineReadEnabled: false,
      calendarEngineWriteEnabled: false,
      calendarEngineGoogleMirrorEnabled: false,
    };
  }) as typeof prisma.organization.findUnique;

  prisma.$queryRawUnsafe = (async (sql: string, ...params: unknown[]) => {
    if (typeof sql === "string" && sql.includes('FROM "Lead"') && sql.includes("FILTER")) {
      assert.equal(params[0], ORG);
      return [{ active: options?.leadActive ?? 41, neu: options?.leadNew ?? 38 }];
    }
    return [];
  }) as typeof prisma.$queryRawUnsafe;

  prisma.task.count = (async () =>
    bump(async () => options?.tasks ?? 32)) as typeof prisma.task.count;

  prisma.task.findMany = (async (args) => {
    const take = (args as { take?: number }).take ?? 500;
    assert.ok(take <= DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT);
    const n = options?.taskRows ?? Math.min(take, 3);
    return Array.from({ length: n }, (_, i) => ({
      id: `task-${i}`,
      title: `Task ${i}`,
      supplier: null,
      priority: "normal",
      status: "open",
      dueDate: null,
      updatedAt: NOW,
      createdAt: NOW,
    }));
  }) as typeof prisma.task.findMany;

  prisma.appointment.count = (async () =>
    bump(async () => options?.appointments ?? 0)) as typeof prisma.appointment.count;
  prisma.calendarEvent.count = (async () => bump(async () => 0)) as typeof prisma.calendarEvent.count;

  prisma.financialDocumentReview.findMany = (async () => {
    fdrFindManyCalls += 1;
    return [];
  }) as typeof prisma.financialDocumentReview.findMany;

  prisma.financialDocumentReview.count = (async () =>
    bump(async () => options?.pendingDocs ?? 185)) as typeof prisma.financialDocumentReview.count;

  prisma.alert.count = (async () =>
    bump(async () => {
      if (options?.failAlerts) throw new Error("alerts boom");
      return options?.alerts ?? 5457;
    })) as typeof prisma.alert.count;

  prisma.integration.findUnique = (async () => ({
    refreshToken: options?.connected === false ? null : "rt",
    connectedAt: NOW,
  })) as typeof prisma.integration.findUnique;

  prisma.syncLog.findFirst = (async (args) => {
    const where = (args as { where?: { status?: unknown; finishedAt?: null } }).where ?? {};
    if (where.finishedAt === null || (where.status && typeof where.status === "object")) {
      return options?.scanning ? { id: "scan-active", finishedAt: null } : null;
    }
    return { finishedAt: NOW };
  }) as typeof prisma.syncLog.findFirst;

  return {
    getOrgLookups: () => orgLookups,
    getFdrFindManyCalls: () => fdrFindManyCalls,
    getMaxParallel: () => maxParallel,
    restore() {
      prisma.organization.findUnique = originals.organizationFindUnique;
      prisma.task.count = originals.taskCount;
      prisma.task.findMany = originals.taskFindMany;
      prisma.appointment.count = originals.appointmentCount;
      prisma.calendarEvent.count = originals.calendarEventCount;
      prisma.financialDocumentReview.count = originals.fdrCount;
      prisma.financialDocumentReview.findMany = originals.fdrFindMany;
      prisma.$queryRawUnsafe = originals.queryRaw;
      prisma.alert.count = originals.alertCount;
      prisma.integration.findUnique = originals.integrationFindUnique;
      prisma.syncLog.findFirst = originals.syncLogFindFirst;
      resetCrossOrgContaminatedGmailIdsCacheForTests();
    },
  };
}

test("bootstrap KPI parity with home-metrics logic", async () => {
  const mocks = installBootstrapMocks();
  try {
    const bootstrap = await getDashboardBootstrap(ORG, { now: NOW });
    const home = await getDashboardHomeMetrics(ORG, NOW);
    assert.deepEqual(bootstrap.homeMetrics.metrics, home.metrics);
    assert.equal(bootstrap.homeMetrics.metrics.active_clients, 41);
    assert.equal(bootstrap.homeMetrics.metrics.open_tasks, 32);
    assert.equal(bootstrap.homeMetrics.metrics.meetings_today, 0);
    assert.equal(bootstrap.homeMetrics.metrics.pending_docs, 185);
    assert.equal(bootstrap.homeMetrics.metrics.new_clients_this_month, 38);
    assert.equal(bootstrap.homeMetrics.metrics.unread_alerts, 5457);
  } finally {
    mocks.restore();
  }
});

test("bootstrap organization isolation and single org lookup", async () => {
  const mocks = installBootstrapMocks();
  try {
    const payload = await getDashboardBootstrap(ORG, { now: NOW, collectTiming: true });
    assert.equal(payload.homeMetrics.organizationId, ORG);
    assert.notEqual(payload.homeMetrics.organizationId, ORG_OTHER);
    assert.equal(mocks.getOrgLookups(), 1);
    assert.equal(payload.organizationSettings.id, ORG);
  } finally {
    mocks.restore();
  }
});

test("bootstrap zero-data organization", async () => {
  const mocks = installBootstrapMocks({
    leadActive: 0,
    leadNew: 0,
    tasks: 0,
    appointments: 0,
    pendingDocs: 0,
    alerts: 0,
    taskRows: 0,
    connected: false,
    scanning: false,
  });
  try {
    const payload = await getDashboardBootstrap(ORG, { now: NOW });
    assert.deepEqual(payload.homeMetrics.metrics, {
      active_clients: 0,
      open_tasks: 0,
      meetings_today: 0,
      pending_docs: 0,
      new_clients_this_month: 0,
      unread_alerts: 0,
    });
    assert.equal(payload.tasksPreview.length, 0);
    assert.equal(payload.gmailStatus.connected, false);
  } finally {
    mocks.restore();
  }
});

test("bootstrap payload whitelist, tasks≤8, size<50KB, stable shape", async () => {
  const mocks = installBootstrapMocks({ taskRows: 8 });
  try {
    const payload = await getDashboardBootstrap(ORG, { now: NOW });
    assert.ok(payload.organizationSettings);
    assert.ok(payload.homeMetrics.metrics);
    assert.ok(payload.gmailStatus);
    assert.ok(Array.isArray(payload.tasksPreview));
    assert.ok(payload.generatedAt);
    assert.ok(payload.organizationSettings.displayName);
    assert.ok(payload.organizationSettings.businessName !== undefined);
    assert.ok(payload.organizationSettings.timezone);
    assert.ok(payload.organizationSettings.locale);
    assert.ok(payload.tasksPreview.length <= DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT);
    assert.equal(payload.tasksPreview.length, 8);
    assertDashboardBootstrapPayloadBounds(payload);
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    assert.ok(bytes < DASHBOARD_BOOTSTRAP_MAX_PAYLOAD_BYTES);
    assert.equal(mocks.getFdrFindManyCalls(), 0);
  } finally {
    mocks.restore();
  }
});

test("bootstrap has no Google API markers and concurrency bounded", async () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, "dashboardBootstrap.ts"), "utf8");
  const importBlock = src.split("export const DASHBOARD_BOOTSTRAP_TASKS_PREVIEW_LIMIT")[0] ?? src;
  for (const marker of DASHBOARD_BOOTSTRAP_FORBIDDEN_IMPORT_MARKERS) {
    assert.doesNotMatch(importBlock, new RegExp(marker));
  }
  assert.doesNotMatch(importBlock, /from ["'].*google/);
  const mocks = installBootstrapMocks();
  try {
    await getDashboardBootstrap(ORG, { now: NOW });
    assert.ok(mocks.getMaxParallel() <= 5, `max parallel ${mocks.getMaxParallel()} > 5`);
  } finally {
    mocks.restore();
  }
});

test("bootstrap query failure does not return fake zeros", async () => {
  const mocks = installBootstrapMocks({ failAlerts: true });
  try {
    await assert.rejects(() => getDashboardBootstrap(ORG, { now: NOW }), /alerts boom/);
  } finally {
    mocks.restore();
  }
});
