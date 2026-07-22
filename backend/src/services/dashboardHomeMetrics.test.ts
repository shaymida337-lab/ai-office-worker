import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  buildPendingDocsWhereForTests,
  countDashboardHomeMetricsDirect,
  countPendingDocumentReviews,
  getDashboardHomeMetrics,
} from "./dashboardHomeMetrics.js";
import {
  loadCrossOrgContaminatedGmailIdsForReads,
  resetCrossOrgContaminatedGmailIdsCacheForTests,
} from "./p0/financialReadIsolation.js";
import { buildDocumentReviewsListWhere } from "./documentReviewsHomeSummary.js";

const ORG = "org-home-metrics-test";
const ORG_OTHER = "org-home-metrics-other";
const NOW = new Date("2026-07-15T10:00:00.000Z");

function installBaseMocks(options?: {
  leadActive?: number;
  leadNew?: number;
  tasks?: number;
  appointments?: number;
  calendarEvents?: number;
  pendingDocs?: number;
  alerts?: number;
  readEnabled?: boolean;
}) {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    leadCount: prisma.lead.count.bind(prisma.lead),
    taskCount: prisma.task.count.bind(prisma.task),
    appointmentCount: prisma.appointment.count.bind(prisma.appointment),
    calendarEventCount: prisma.calendarEvent.count.bind(prisma.calendarEvent),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    fdrFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
    alertCount: prisma.alert.count.bind(prisma.alert),
  };

  const countCalls: Array<{ model: string; args: unknown; at: number }> = [];
  let findManyCalls = 0;

  resetCrossOrgContaminatedGmailIdsCacheForTests();

  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: options?.readEnabled ?? false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.lead.count = (async (args) => {
    countCalls.push({ model: "lead", args, at: Date.now() });
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    if (where.stage && typeof where.stage === "object" && where.stage !== null && "notIn" in where.stage) {
      return options?.leadActive ?? 41;
    }
    if (where.stage === "חדש") return options?.leadNew ?? 38;
    return 0;
  }) as typeof prisma.lead.count;

  prisma.task.count = (async (args) => {
    countCalls.push({ model: "task", args, at: Date.now() });
    return options?.tasks ?? 5;
  }) as typeof prisma.task.count;

  prisma.appointment.count = (async (args) => {
    countCalls.push({ model: "appointment", args, at: Date.now() });
    return options?.appointments ?? 3;
  }) as typeof prisma.appointment.count;

  prisma.calendarEvent.count = (async (args) => {
    countCalls.push({ model: "calendarEvent", args, at: Date.now() });
    return options?.calendarEvents ?? 99;
  }) as typeof prisma.calendarEvent.count;

  prisma.financialDocumentReview.findMany = (async () => {
    findManyCalls += 1;
    return [];
  }) as typeof prisma.financialDocumentReview.findMany;

  prisma.$queryRawUnsafe = (async (sql: string, ...params: unknown[]) => {
    if (typeof sql === "string" && sql.includes('FROM "Lead"') && sql.includes("FILTER")) {
      countCalls.push({ model: "lead", args: { sql, params }, at: Date.now() });
      assert.equal(params[0], ORG, "Lead dual-count must scope organizationId");
      return [{ active: options?.leadActive ?? 41, neu: options?.leadNew ?? 38 }];
    }
    return [];
  }) as typeof prisma.$queryRawUnsafe;

  prisma.financialDocumentReview.count = (async (args) => {
    countCalls.push({ model: "financialDocumentReview", args, at: Date.now() });
    return options?.pendingDocs ?? 4;
  }) as typeof prisma.financialDocumentReview.count;

  prisma.alert.count = (async (args) => {
    countCalls.push({ model: "alert", args, at: Date.now() });
    return options?.alerts ?? 6;
  }) as typeof prisma.alert.count;

  return {
    originals,
    countCalls,
    getFindManyCalls: () => findManyCalls,
    restore() {
      prisma.organization.findUnique = originals.organizationFindUnique;
      prisma.lead.count = originals.leadCount;
      prisma.task.count = originals.taskCount;
      prisma.appointment.count = originals.appointmentCount;
      prisma.calendarEvent.count = originals.calendarEventCount;
      prisma.financialDocumentReview.count = originals.fdrCount;
      prisma.financialDocumentReview.findMany = originals.fdrFindMany;
      prisma.$queryRawUnsafe = originals.queryRaw;
      prisma.alert.count = originals.alertCount;
      resetCrossOrgContaminatedGmailIdsCacheForTests();
    },
  };
}

test("getDashboardHomeMetrics matches direct prisma counts for organization", async () => {
  const mocks = installBaseMocks();
  try {
    const direct = await countDashboardHomeMetricsDirect(ORG, NOW);
    const payload = await getDashboardHomeMetrics(ORG, NOW);

    assert.deepEqual(payload.metrics, direct);
    assert.equal(payload.metrics.active_clients, 41);
    assert.equal(payload.metrics.open_tasks, 5);
    assert.equal(payload.metrics.meetings_today, 3);
    assert.equal(payload.metrics.pending_docs, 4);
    assert.equal(payload.metrics.new_clients_this_month, 38);
    assert.equal(payload.metrics.unread_alerts, 6);
    assert.equal(payload.organizationId, ORG);
    assert.equal(payload.timeZone, "Asia/Jerusalem");

    for (const call of mocks.countCalls) {
      if (call.model === "lead" && (call.args as { sql?: string }).sql) {
        const params = (call.args as { params: unknown[] }).params;
        assert.equal(params[0], ORG, "Lead dual-count must scope organizationId");
        assert.notEqual(params[0], ORG_OTHER);
        continue;
      }
      const where = (call.args as { where?: Record<string, unknown> }).where ?? {};
      assert.equal(where.organizationId, ORG, `${call.model} must scope organizationId`);
    }
  } finally {
    mocks.restore();
  }
});

test("dashboard CRM metrics match getCrmListKpis definitions", async () => {
  const mocks = installBaseMocks();
  try {
    const { getCrmListKpis } = await import("./crm/crmCounts.js");
    const crm = await getCrmListKpis(ORG);
    const home = await getDashboardHomeMetrics(ORG, NOW);
    assert.equal(home.metrics.active_clients, crm.activeCustomers);
    assert.equal(home.metrics.new_clients_this_month, crm.newLeads);
  } finally {
    mocks.restore();
  }
});

test("zero-data organization returns all zero KPIs", async () => {
  const mocks = installBaseMocks({
    leadActive: 0,
    leadNew: 0,
    tasks: 0,
    appointments: 0,
    pendingDocs: 0,
    alerts: 0,
  });
  try {
    const payload = await getDashboardHomeMetrics(ORG, NOW);
    assert.deepEqual(payload.metrics, {
      active_clients: 0,
      open_tasks: 0,
      meetings_today: 0,
      pending_docs: 0,
      new_clients_this_month: 0,
      unread_alerts: 0,
    });
  } finally {
    mocks.restore();
  }
});

test("pending_docs uses document-reviews where policy and no unbounded findMany", async () => {
  const mocks = installBaseMocks({ pendingDocs: 7 });
  try {
    await getDashboardHomeMetrics(ORG, NOW, { collectTiming: true });
    assert.equal(mocks.getFindManyCalls(), 0, "home-metrics must not findMany FDR rows");

    const fdrCalls = mocks.countCalls.filter((c) => c.model === "financialDocumentReview");
    assert.equal(fdrCalls.length, 1);
    const where = (fdrCalls[0]!.args as { where: unknown }).where;
    const expected = buildDocumentReviewsListWhere(ORG, "needs_review", []);
    assert.deepEqual(where, expected);
    assert.deepEqual(where, buildPendingDocsWhereForTests(ORG, []));
  } finally {
    mocks.restore();
  }
});

test("countPendingDocumentReviews isolation: contaminated gmail excluded, foreign org ignored", async () => {
  resetCrossOrgContaminatedGmailIdsCacheForTests();
  const originals = {
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
  };

  prisma.$queryRawUnsafe = (async () => [
    { gmail_id: "gmail-shared-cross-org" },
  ]) as typeof prisma.$queryRawUnsafe;

  prisma.financialDocumentReview.count = (async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    assert.equal(where.organizationId, ORG);
    assert.equal(where.reviewStatus, "needs_review");
    const expected = buildDocumentReviewsListWhere(ORG, "needs_review", ["gmail-shared-cross-org"]);
    assert.deepEqual(where, expected);
    return 1;
  }) as typeof prisma.financialDocumentReview.count;

  try {
    const count = await countPendingDocumentReviews(ORG);
    assert.equal(count, 1);
    // Preloaded contaminated path skips global SQL when provided:
    const count2 = await countPendingDocumentReviews(ORG, ["gmail-shared-cross-org"]);
    assert.equal(count2, 1);
  } finally {
    prisma.financialDocumentReview.count = originals.fdrCount;
    prisma.$queryRawUnsafe = originals.queryRaw;
    resetCrossOrgContaminatedGmailIdsCacheForTests();
  }
});

test("independent counters overlap in time (parallel wave)", async () => {
  const mocks = installBaseMocks();
  const started: number[] = [];
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  prisma.$queryRawUnsafe = (async (sql: string, ...params: unknown[]) => {
    if (typeof sql === "string" && sql.includes('FROM "Lead"')) {
      started.push(Date.now());
      await delay(40);
      return [{ active: 41, neu: 38 }];
    }
    return [];
  }) as typeof prisma.$queryRawUnsafe;
  prisma.task.count = (async () => {
    started.push(Date.now());
    await delay(40);
    return 5;
  }) as typeof prisma.task.count;
  prisma.appointment.count = (async () => {
    started.push(Date.now());
    await delay(40);
    return 3;
  }) as typeof prisma.appointment.count;
  prisma.alert.count = (async () => {
    started.push(Date.now());
    await delay(40);
    return 6;
  }) as typeof prisma.alert.count;
  prisma.financialDocumentReview.count = (async () => {
    started.push(Date.now());
    await delay(40);
    return 4;
  }) as typeof prisma.financialDocumentReview.count;

  try {
    const t0 = Date.now();
    await getDashboardHomeMetrics(ORG, NOW);
    const elapsed = Date.now() - t0;
    assert.ok(started.length >= 5, "expected multiple counters to start");
    const spread = Math.max(...started) - Math.min(...started);
    assert.ok(spread < 35, `counters should start nearly together, spread=${spread}ms`);
    assert.ok(elapsed < 200, `parallel wave should not be fully sequential, elapsed=${elapsed}ms`);
  } finally {
    mocks.restore();
  }
});

test("counter failure fails closed (no fake zero KPI)", async () => {
  const mocks = installBaseMocks();
  prisma.task.count = (async () => {
    throw new Error("task count boom");
  }) as typeof prisma.task.count;
  try {
    await assert.rejects(() => getDashboardHomeMetrics(ORG, NOW), /task count boom/);
  } finally {
    mocks.restore();
  }
});

test("collectTiming reports stages without changing metrics JSON", async () => {
  const mocks = installBaseMocks();
  try {
    let timing: import("./dashboardHomeMetrics.js").DashboardHomeMetricsTiming | null = null;
    const withTiming = await getDashboardHomeMetrics(ORG, NOW, {
      collectTiming: true,
      onTiming: (t) => {
        timing = t;
      },
    });
    const plain = await getDashboardHomeMetrics(ORG, NOW);
    assert.deepEqual(withTiming.metrics, plain.metrics);
    assert.ok(timing);
    assert.ok(timing!.totalMs >= 0);
    assert.ok(timing!.queryCountEstimate >= 7);
    assert.equal("metrics" in withTiming && !("timing" in withTiming), true);
  } finally {
    mocks.restore();
  }
});

test("organization isolation: other org never appears in count where", async () => {
  const mocks = installBaseMocks();
  try {
    await getDashboardHomeMetrics(ORG, NOW);
    for (const call of mocks.countCalls) {
      if (call.model === "lead" && (call.args as { sql?: string }).sql) {
        assert.equal((call.args as { params: unknown[] }).params[0], ORG);
        continue;
      }
      const where = (call.args as { where?: Record<string, unknown> }).where ?? {};
      assert.equal(where.organizationId, ORG);
      assert.notEqual(where.organizationId, ORG_OTHER);
    }
  } finally {
    mocks.restore();
  }
});

test("pending_docs parity helper matches list where builder", () => {
  const contaminated = ["g1", "g2"];
  assert.deepEqual(
    buildPendingDocsWhereForTests(ORG, contaminated),
    buildDocumentReviewsListWhere(ORG, "needs_review", contaminated),
  );
});

test("loadCrossOrgContaminatedGmailIdsForReads is used by pending path (cache warm skips SQL)", async () => {
  resetCrossOrgContaminatedGmailIdsCacheForTests();
  let contaminatedSqlCalls = 0;
  const originals = {
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
  };
  prisma.$queryRawUnsafe = (async (sql: string) => {
    if (typeof sql === "string" && sql.includes("GmailScanItem") && sql.includes("HAVING")) {
      contaminatedSqlCalls += 1;
      return [];
    }
    return [];
  }) as typeof prisma.$queryRawUnsafe;
  prisma.financialDocumentReview.count = (async () => 0) as typeof prisma.financialDocumentReview.count;

  try {
    await loadCrossOrgContaminatedGmailIdsForReads();
    assert.equal(contaminatedSqlCalls, 1);
    await countPendingDocumentReviews(ORG);
    // warm cache: countPending should not hit contaminated SQL again
    assert.equal(contaminatedSqlCalls, 1);
  } finally {
    prisma.$queryRawUnsafe = originals.queryRaw;
    prisma.financialDocumentReview.count = originals.fdrCount;
    resetCrossOrgContaminatedGmailIdsCacheForTests();
  }
});
