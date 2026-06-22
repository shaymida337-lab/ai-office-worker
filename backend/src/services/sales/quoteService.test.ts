import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  computeQuoteTotals,
  createQuoteForDeal,
  updateQuote,
  validateQuoteLineInput,
} from "./quoteService.js";

const ORG = "org-quote-test";
const DEAL_ID = "deal-1";

test("computeQuoteTotals sums line amounts", () => {
  const totals = computeQuoteTotals([
    { quantity: 2, unitPrice: 100 },
    { quantity: 1, unitPrice: 50.5 },
  ]);
  assert.equal(totals.subtotal, 250.5);
  assert.equal(totals.total, 250.5);
});

test("validateQuoteLineInput accepts serviceId without unitPrice", () => {
  const result = validateQuoteLineInput({ serviceId: "svc-1", quantity: 1 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.serviceId, "svc-1");
    assert.equal(result.value.unitPrice, 0);
  }
});

test("validateQuoteLineInput rejects zero quantity", () => {
  const result = validateQuoteLineInput({ description: "Consult", quantity: 0, unitPrice: 100 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "quantity must be positive");
});

test("validateQuoteLineInput rejects missing description and service", () => {
  const result = validateQuoteLineInput({ quantity: 1, unitPrice: 100 });
  assert.equal(result.ok, false);
});

test("createQuoteForDeal creates version 1 and updates deal stage", async () => {
  const originalDealFind = prisma.deal.findFirst.bind(prisma.deal);
  const originalQuoteFind = prisma.quote.findFirst.bind(prisma.quote);
  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalEventCreate = prisma.quoteEvent.create.bind(prisma.quoteEvent);
  const originalServiceFind = prisma.service.findFirst.bind(prisma.service);

  prisma.deal.findFirst = (async () => ({
    id: DEAL_ID,
    organizationId: ORG,
    stage: "open",
    title: "Dana",
  })) as unknown as typeof prisma.deal.findFirst;
  prisma.quote.findFirst = (async () => null) as unknown as typeof prisma.quote.findFirst;
  prisma.service.findFirst = (async () => null) as unknown as typeof prisma.service.findFirst;
  prisma.$transaction = (async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      quote: {
        create: async () => ({
          id: "quote-1",
          organizationId: ORG,
          dealId: DEAL_ID,
          version: 1,
          status: "draft",
          subtotal: 350,
          total: 350,
          currency: "ILS",
          validUntil: new Date(),
          notes: null,
          lines: [
            { id: "line-1", description: "Consult", quantity: 1, unitPrice: 350, sortOrder: 0, serviceId: null, service: null },
          ],
        }),
      },
      deal: { update: async () => ({ id: DEAL_ID }) },
      quoteLine: { deleteMany: async () => ({ count: 0 }) },
    })
  ) as unknown as typeof prisma.$transaction;
  prisma.quoteEvent.create = (async () => ({ id: "evt-1" })) as unknown as typeof prisma.quoteEvent.create;

  try {
    const quote = await createQuoteForDeal(ORG, DEAL_ID, {
      lines: [{ description: "Consult", quantity: 1, unitPrice: 350 }],
    });
    assert.equal(quote.version, 1);
    assert.equal(quote.total, 350);
  } finally {
    prisma.deal.findFirst = originalDealFind;
    prisma.quote.findFirst = originalQuoteFind;
    prisma.$transaction = originalTransaction;
    prisma.quoteEvent.create = originalEventCreate;
    prisma.service.findFirst = originalServiceFind;
  }
});

test("updateQuote rejects non-draft quotes", async () => {
  const originalQuoteFind = prisma.quote.findFirst.bind(prisma.quote);
  prisma.quote.findFirst = (async () => ({
    id: "quote-1",
    organizationId: ORG,
    dealId: DEAL_ID,
    status: "sent",
    total: 350,
    lines: [],
  })) as unknown as typeof prisma.quote.findFirst;

  try {
    await assert.rejects(
      () => updateQuote(ORG, "quote-1", { notes: "updated" }),
      /Only draft quotes can be edited/
    );
  } finally {
    prisma.quote.findFirst = originalQuoteFind;
  }
});

test("createQuoteForDeal supersedes previous quotes when creating version 2", async () => {
  const originalDealFind = prisma.deal.findFirst.bind(prisma.deal);
  const originalQuoteFind = prisma.quote.findFirst.bind(prisma.quote);
  const originalQuoteUpdateMany = prisma.quote.updateMany.bind(prisma.quote);
  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalEventCreate = prisma.quoteEvent.create.bind(prisma.quoteEvent);
  const originalServiceFind = prisma.service.findFirst.bind(prisma.service);

  let updateManyArgs: Parameters<typeof prisma.quote.updateMany>[0] | undefined;

  prisma.deal.findFirst = (async () => ({ id: DEAL_ID, organizationId: ORG })) as unknown as typeof prisma.deal.findFirst;
  prisma.quote.findFirst = (async () => ({ version: 1 })) as unknown as typeof prisma.quote.findFirst;
  prisma.quote.updateMany = (async (args: Parameters<typeof prisma.quote.updateMany>[0]) => {
    updateManyArgs = args;
    return { count: 1 };
  }) as unknown as typeof prisma.quote.updateMany;
  prisma.service.findFirst = (async () => null) as unknown as typeof prisma.service.findFirst;
  prisma.$transaction = (async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      quote: {
        create: async () => ({
          id: "quote-2",
          version: 2,
          status: "draft",
          total: 400,
          subtotal: 400,
          currency: "ILS",
          organizationId: ORG,
          dealId: DEAL_ID,
          validUntil: new Date(),
          notes: null,
          lines: [],
        }),
      },
      deal: { update: async () => ({ id: DEAL_ID }) },
    })
  ) as unknown as typeof prisma.$transaction;
  prisma.quoteEvent.create = (async () => ({ id: "evt-2" })) as unknown as typeof prisma.quoteEvent.create;

  try {
    const quote = await createQuoteForDeal(ORG, DEAL_ID, {
      lines: [{ description: "Consult", quantity: 1, unitPrice: 400 }],
    });
    assert.equal(quote.version, 2);
    assert.equal(updateManyArgs?.where?.dealId, DEAL_ID);
    assert.deepEqual(updateManyArgs?.data, { status: "superseded", approvalToken: null });
  } finally {
    prisma.deal.findFirst = originalDealFind;
    prisma.quote.findFirst = originalQuoteFind;
    prisma.quote.updateMany = originalQuoteUpdateMany;
    prisma.$transaction = originalTransaction;
    prisma.quoteEvent.create = originalEventCreate;
    prisma.service.findFirst = originalServiceFind;
  }
});
