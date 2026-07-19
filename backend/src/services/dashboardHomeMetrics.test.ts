import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  countDashboardHomeMetricsDirect,
  countPendingDocumentReviews,
  getDashboardHomeMetrics,
} from "./dashboardHomeMetrics.js";
import {
  buildFinancialDocumentReviewReadIsolationWhere,
  mergePrismaWhere,
} from "./p0/financialReadIsolation.js";
import { listCrossOrgContaminatedGmailMessageIdsAmong } from "./p0/crossOrgGmailQuarantine.js";

const ORG = "org-home-metrics-test";
const ORG_OTHER = "org-home-metrics-other";
const NOW = new Date("2026-07-15T10:00:00.000Z");

test("getDashboardHomeMetrics matches direct prisma counts for organization", async () => {
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

  const countCalls: Array<{ model: string; args: unknown }> = [];

  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.lead.count = (async (args) => {
    countCalls.push({ model: "lead", args });
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    if (where.stage && typeof where.stage === "object" && where.stage !== null && "notIn" in where.stage) {
      return 41;
    }
    if (where.stage === "חדש") return 38;
    return 0;
  }) as typeof prisma.lead.count;

  prisma.task.count = (async (args) => {
    countCalls.push({ model: "task", args });
    return 5;
  }) as typeof prisma.task.count;

  prisma.appointment.count = (async (args) => {
    countCalls.push({ model: "appointment", args });
    return 3;
  }) as typeof prisma.appointment.count;

  prisma.calendarEvent.count = (async (args) => {
    countCalls.push({ model: "calendarEvent", args });
    return 99;
  }) as typeof prisma.calendarEvent.count;

  prisma.financialDocumentReview.findMany = (async () => [
    { gmailMessageId: "gmail-clean-1" },
  ]) as typeof prisma.financialDocumentReview.findMany;

  prisma.$queryRawUnsafe = (async () => []) as typeof prisma.$queryRawUnsafe;

  prisma.financialDocumentReview.count = (async (args) => {
    countCalls.push({ model: "financialDocumentReview", args });
    return 4;
  }) as typeof prisma.financialDocumentReview.count;

  prisma.alert.count = (async (args) => {
    countCalls.push({ model: "alert", args });
    return 6;
  }) as typeof prisma.alert.count;

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

    for (const call of countCalls) {
      const where = (call.args as { where?: Record<string, unknown> }).where ?? {};
      assert.equal(where.organizationId, ORG, `${call.model} must scope organizationId`);
    }
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.lead.count = originals.leadCount;
    prisma.task.count = originals.taskCount;
    prisma.appointment.count = originals.appointmentCount;
    prisma.calendarEvent.count = originals.calendarEventCount;
    prisma.financialDocumentReview.count = originals.fdrCount;
    prisma.financialDocumentReview.findMany = originals.fdrFindMany;
    prisma.$queryRawUnsafe = originals.queryRaw;
    prisma.alert.count = originals.alertCount;
  }
});

test("dashboard CRM metrics match getCrmListKpis definitions", async () => {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    leadCount: prisma.lead.count.bind(prisma.lead),
    taskCount: prisma.task.count.bind(prisma.task),
    appointmentCount: prisma.appointment.count.bind(prisma.appointment),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    fdrFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
    alertCount: prisma.alert.count.bind(prisma.alert),
  };

  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.lead.count = (async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    if (where.stage && typeof where.stage === "object" && where.stage !== null && "notIn" in where.stage) {
      return 41;
    }
    if (where.stage === "חדש") return 38;
    return 0;
  }) as typeof prisma.lead.count;
  prisma.task.count = (async () => 0) as typeof prisma.task.count;
  prisma.appointment.count = (async () => 0) as typeof prisma.appointment.count;
  prisma.financialDocumentReview.findMany = (async () => []) as typeof prisma.financialDocumentReview.findMany;
  prisma.$queryRawUnsafe = (async () => []) as typeof prisma.$queryRawUnsafe;
  prisma.financialDocumentReview.count = (async () => 0) as typeof prisma.financialDocumentReview.count;
  prisma.alert.count = (async () => 0) as typeof prisma.alert.count;

  try {
    const { getCrmListKpis } = await import("./crm/crmCounts.js");
    const crm = await getCrmListKpis(ORG);
    const home = await getDashboardHomeMetrics(ORG, NOW);
    assert.equal(home.metrics.active_clients, crm.activeCustomers);
    assert.equal(home.metrics.new_clients_this_month, crm.newLeads);
  } finally {
    prisma.organization.findUnique = originals.organizationFindUnique;
    prisma.lead.count = originals.leadCount;
    prisma.task.count = originals.taskCount;
    prisma.appointment.count = originals.appointmentCount;
    prisma.financialDocumentReview.count = originals.fdrCount;
    prisma.financialDocumentReview.findMany = originals.fdrFindMany;
    prisma.$queryRawUnsafe = originals.queryRaw;
    prisma.alert.count = originals.alertCount;
  }
});

test("listCrossOrgContaminatedGmailMessageIdsAmong scopes GROUP BY to candidates only", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params });
      return [{ gmail_id: "gmail-shared" }];
    },
  };

  const ids = await listCrossOrgContaminatedGmailMessageIdsAmong(
    ["gmail-clean", "gmail-shared", ""],
    db,
  );

  assert.deepEqual(ids, ["gmail-shared"]);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /WHERE "gmailMessageId" = ANY\(\$1::text\[\]\)/);
  assert.match(calls[0]!.sql, /HAVING COUNT\(DISTINCT "organizationId"\) > 1/);
  assert.deepEqual(calls[0]!.params[0], ["gmail-clean", "gmail-shared"]);
});

test("listCrossOrgContaminatedGmailMessageIdsAmong skips query when no candidates", async () => {
  let called = false;
  const db = {
    $queryRawUnsafe: async () => {
      called = true;
      return [];
    },
  };
  const ids = await listCrossOrgContaminatedGmailMessageIdsAmong([], db);
  assert.deepEqual(ids, []);
  assert.equal(called, false);
});

test("countPendingDocumentReviews isolation: clean counted, contaminated + foreign excluded", async () => {
  const originals = {
    fdrFindMany: prisma.financialDocumentReview.findMany.bind(prisma.financialDocumentReview),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
    queryRaw: prisma.$queryRawUnsafe.bind(prisma),
  };

  type ReviewRow = {
    organizationId: string;
    reviewStatus: string;
    gmailMessageId: string | null;
    uncertaintyReason: string | null;
  };

  const reviews: ReviewRow[] = [
    {
      organizationId: ORG,
      reviewStatus: "needs_review",
      gmailMessageId: "gmail-clean-org",
      uncertaintyReason: null,
    },
    {
      organizationId: ORG,
      reviewStatus: "needs_review",
      gmailMessageId: "gmail-shared-cross-org",
      uncertaintyReason: null,
    },
    {
      organizationId: ORG_OTHER,
      reviewStatus: "needs_review",
      gmailMessageId: "gmail-other-org-only",
      uncertaintyReason: null,
    },
  ];

  const gsiOrgsByGmail = new Map<string, Set<string>>([
    ["gmail-clean-org", new Set([ORG])],
    ["gmail-shared-cross-org", new Set([ORG, ORG_OTHER])],
    ["gmail-other-org-only", new Set([ORG_OTHER])],
  ]);

  let amongCandidates: string[] | null = null;

  prisma.financialDocumentReview.findMany = (async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    assert.equal(where.organizationId, ORG);
    assert.equal(where.reviewStatus, "needs_review");
    return reviews
      .filter((row) => row.organizationId === ORG && row.reviewStatus === "needs_review" && row.gmailMessageId)
      .map((row) => ({ gmailMessageId: row.gmailMessageId }));
  }) as typeof prisma.financialDocumentReview.findMany;

  prisma.$queryRawUnsafe = (async (sql: string, ...params: unknown[]) => {
    assert.match(sql, /WHERE "gmailMessageId" = ANY\(\$1::text\[\]\)/);
    amongCandidates = params[0] as string[];
    const candidates = new Set(amongCandidates);
    const contaminated: Array<{ gmail_id: string }> = [];
    for (const [gmailId, orgs] of gsiOrgsByGmail) {
      if (candidates.has(gmailId) && orgs.size > 1) {
        contaminated.push({ gmail_id: gmailId });
      }
    }
    return contaminated;
  }) as typeof prisma.$queryRawUnsafe;

  prisma.financialDocumentReview.count = (async (args) => {
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    assert.equal(where.organizationId, ORG);
    assert.equal(where.reviewStatus, "needs_review");

    const expectedIsolation = buildFinancialDocumentReviewReadIsolationWhere(ORG, [
      "gmail-shared-cross-org",
    ]);
    const expectedWhere = mergePrismaWhere(
      { organizationId: ORG, reviewStatus: "needs_review" },
      expectedIsolation,
    );
    assert.deepEqual(where, expectedWhere);

    const excluded = new Set(["gmail-shared-cross-org"]);
    return reviews.filter((row) => {
      if (row.organizationId !== ORG || row.reviewStatus !== "needs_review") return false;
      if (row.gmailMessageId && excluded.has(row.gmailMessageId)) return false;
      return true;
    }).length;
  }) as typeof prisma.financialDocumentReview.count;

  try {
    const count = await countPendingDocumentReviews(ORG);
    assert.equal(count, 1, "only the clean org document is counted");
    assert.ok(amongCandidates);
    assert.deepEqual(
      [...amongCandidates!].sort(),
      ["gmail-clean-org", "gmail-shared-cross-org"].sort(),
      "contamination query must only see this org's pending gmail IDs",
    );
    assert.ok(!amongCandidates!.includes("gmail-other-org-only"));
  } finally {
    prisma.financialDocumentReview.findMany = originals.fdrFindMany;
    prisma.financialDocumentReview.count = originals.fdrCount;
    prisma.$queryRawUnsafe = originals.queryRaw;
  }
});
