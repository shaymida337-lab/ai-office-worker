import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../lib/prisma.js";
import {
  countCrmActiveCustomers,
  countCrmNewLeads,
  countCrmOpenReminders,
  getCrmListKpis,
} from "./crmCounts.js";

const ORG = "org-crm-counts-test";

test("CRM list KPI counts scope organizationId and match CRM definitions", async () => {
  const originals = {
    leadCount: prisma.lead.count.bind(prisma.lead),
  };
  const countCalls: unknown[] = [];

  prisma.lead.count = (async (args) => {
    countCalls.push(args);
    const where = (args as { where?: Record<string, unknown> }).where ?? {};
    if (where.stage && typeof where.stage === "object" && where.stage !== null && "notIn" in where.stage) {
      return 41;
    }
    if (where.stage === "חדש") return 38;
    if (where.nextReminderAt) return 7;
    return 0;
  }) as typeof prisma.lead.count;

  try {
    const list = await getCrmListKpis(ORG);
    assert.deepEqual(list, {
      activeCustomers: 41,
      newLeads: 38,
      openTasks: 7,
      unattended: 0,
    });
    assert.equal(await countCrmActiveCustomers(ORG), 41);
    assert.equal(await countCrmNewLeads(ORG), 38);
    assert.equal(await countCrmOpenReminders(ORG), 7);

    for (const args of countCalls) {
      const where = (args as { where?: { organizationId?: string } }).where ?? {};
      assert.equal(where.organizationId, ORG);
    }
  } finally {
    prisma.lead.count = originals.leadCount;
  }
});
