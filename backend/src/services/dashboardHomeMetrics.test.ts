import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../lib/prisma.js";
import {
  countDashboardHomeMetricsDirect,
  getDashboardHomeMetrics,
} from "./dashboardHomeMetrics.js";

const ORG = "org-home-metrics-test";
const NOW = new Date("2026-07-15T10:00:00.000Z");

test("getDashboardHomeMetrics matches direct prisma counts for organization", async () => {
  const originals = {
    organizationFindUnique: prisma.organization.findUnique.bind(prisma.organization),
    leadCount: prisma.lead.count.bind(prisma.lead),
    taskCount: prisma.task.count.bind(prisma.task),
    appointmentCount: prisma.appointment.count.bind(prisma.appointment),
    calendarEventCount: prisma.calendarEvent.count.bind(prisma.calendarEvent),
    fdrCount: prisma.financialDocumentReview.count.bind(prisma.financialDocumentReview),
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
    prisma.alert.count = originals.alertCount;
  }
});
