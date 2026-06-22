import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import { createDealFromLead, listDeals, updateDealStage } from "./dealService.js";

const ORG = "org-deal-test";

test("createDealFromLead returns existing deal for duplicate leadId", async () => {
  const existingDeal = { id: "deal-1", leadId: "lead-1", organizationId: ORG, title: "Dana" };
  const originalLeadFind = prisma.lead.findFirst.bind(prisma.lead);
  const originalDealFindUnique = prisma.deal.findUnique.bind(prisma.deal);
  const originalDealFindFirst = prisma.deal.findFirst.bind(prisma.deal);

  prisma.lead.findFirst = (async () => ({ id: "lead-1", name: "Dana", estimatedValue: 100, assignedTo: null })) as unknown as typeof prisma.lead.findFirst;
  prisma.deal.findUnique = (async () => existingDeal) as unknown as typeof prisma.deal.findUnique;
  prisma.deal.findFirst = (async () => ({
    ...existingDeal,
    stage: "open",
    estimatedValue: 100,
    clientId: null,
    assignedTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lead: null,
    client: null,
    quotes: [],
  })) as unknown as typeof prisma.deal.findFirst;

  try {
    const deal = await createDealFromLead(ORG, "lead-1");
    assert.equal(deal.id, "deal-1");
  } finally {
    prisma.lead.findFirst = originalLeadFind;
    prisma.deal.findUnique = originalDealFindUnique;
    prisma.deal.findFirst = originalDealFindFirst;
  }
});

test("createDealFromLead throws when lead is missing", async () => {
  const originalLeadFind = prisma.lead.findFirst.bind(prisma.lead);
  prisma.lead.findFirst = (async () => null) as unknown as typeof prisma.lead.findFirst;
  try {
    await assert.rejects(() => createDealFromLead(ORG, "missing"), /Lead not found/);
  } finally {
    prisma.lead.findFirst = originalLeadFind;
  }
});

test("listDeals scopes by organizationId and optional stage", async () => {
  const original = prisma.deal.findMany.bind(prisma.deal);
  let capturedArgs: Parameters<typeof prisma.deal.findMany>[0];
  prisma.deal.findMany = (async (args: Parameters<typeof prisma.deal.findMany>[0]) => {
    capturedArgs = args;
    return [];
  }) as unknown as typeof prisma.deal.findMany;

  try {
    await listDeals(ORG, { stage: "quoted" });
    assert.equal(capturedArgs!.where!.organizationId, ORG);
    assert.equal((capturedArgs!.where as { stage: string }).stage, "quoted");
  } finally {
    prisma.deal.findMany = original;
  }
});

test("updateDealStage rejects invalid stage", async () => {
  await assert.rejects(() => updateDealStage(ORG, "deal-1", "invalid"), /Invalid deal stage/);
});

test("updateDealStage updates deal when found", async () => {
  const originalFind = prisma.deal.findFirst.bind(prisma.deal);
  const originalUpdate = prisma.deal.update.bind(prisma.deal);
  const originalEventCreate = prisma.quoteEvent.create.bind(prisma.quoteEvent);

  prisma.deal.findFirst = (async () => ({
    id: "deal-1",
    organizationId: ORG,
    stage: "open",
  })) as unknown as typeof prisma.deal.findFirst;
  prisma.deal.update = (async () => ({
    id: "deal-1",
    organizationId: ORG,
    stage: "won",
    title: "Dana",
    estimatedValue: 350,
    leadId: null,
    clientId: null,
    assignedTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lead: null,
    client: null,
    quotes: [],
  })) as unknown as typeof prisma.deal.update;
  prisma.quoteEvent.create = (async () => ({ id: "evt-1" })) as unknown as typeof prisma.quoteEvent.create;

  try {
    const deal = await updateDealStage(ORG, "deal-1", "won");
    assert.equal(deal.stage, "won");
  } finally {
    prisma.deal.findFirst = originalFind;
    prisma.deal.update = originalUpdate;
    prisma.quoteEvent.create = originalEventCreate;
  }
});
