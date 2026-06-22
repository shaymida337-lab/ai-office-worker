import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { DEAL_INCLUDE, DEAL_STAGES, type DealStage } from "./salesConstants.js";
import { logQuoteEvent } from "./quoteEvents.js";

export { DEAL_STAGES };

export type CreateDealInput = {
  leadId?: string | null;
  clientId?: string | null;
  title?: string | null;
  assignedTo?: string | null;
};

export async function createDealFromLead(organizationId: string, leadId: string, assignedTo?: string | null) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId } });
  if (!lead) {
    throw new Error("Lead not found");
  }

  const existing = await prisma.deal.findUnique({ where: { leadId } });
  if (existing) {
    return getDeal(organizationId, existing.id);
  }

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      leadId,
      title: lead.name,
      stage: "open",
      estimatedValue: lead.estimatedValue,
      assignedTo: assignedTo ?? lead.assignedTo,
    },
    include: DEAL_INCLUDE,
  });

  await logQuoteEvent({ dealId: deal.id, type: "deal_created", meta: { leadId } });
  return deal;
}

export async function createDeal(organizationId: string, input: CreateDealInput) {
  if (input.leadId) {
    return createDealFromLead(organizationId, input.leadId, input.assignedTo);
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    throw new Error("title is required when leadId is not provided");
  }

  if (input.clientId) {
    const client = await prisma.client.findFirst({
      where: { id: input.clientId, organizationId, isActive: true },
    });
    if (!client) {
      throw new Error("Client not found");
    }
  }

  const deal = await prisma.deal.create({
    data: {
      organizationId,
      clientId: input.clientId ?? null,
      title,
      stage: "open",
      assignedTo: input.assignedTo ?? null,
    },
    include: DEAL_INCLUDE,
  });

  await logQuoteEvent({ dealId: deal.id, type: "deal_created" });
  return deal;
}

export async function listDeals(organizationId: string, query: Record<string, unknown> = {}) {
  const stage = typeof query.stage === "string" && DEAL_STAGES.includes(query.stage as DealStage)
    ? query.stage
    : undefined;

  return prisma.deal.findMany({
    where: { organizationId, ...(stage ? { stage } : {}) },
    include: DEAL_INCLUDE,
    orderBy: { updatedAt: "desc" },
  });
}

export async function getDeal(organizationId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    include: DEAL_INCLUDE,
  });
  if (!deal) {
    throw new Error("Deal not found");
  }
  return deal;
}

export async function updateDealStage(organizationId: string, dealId: string, stage: string) {
  if (!DEAL_STAGES.includes(stage as DealStage)) {
    throw new Error("Invalid deal stage");
  }

  const existing = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
  if (!existing) {
    throw new Error("Deal not found");
  }

  const deal = await prisma.deal.update({
    where: { id: dealId },
    data: { stage },
    include: DEAL_INCLUDE,
  });

  await logQuoteEvent({
    dealId,
    type: "deal_stage_changed",
    meta: { from: existing.stage, to: stage },
  });

  return deal;
}

export async function updateDeal(
  organizationId: string,
  dealId: string,
  data: Prisma.DealUpdateInput
) {
  const existing = await prisma.deal.findFirst({ where: { id: dealId, organizationId } });
  if (!existing) {
    throw new Error("Deal not found");
  }

  return prisma.deal.update({
    where: { id: dealId },
    data,
    include: DEAL_INCLUDE,
  });
}
