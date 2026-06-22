import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export async function logQuoteEvent(input: {
  dealId: string;
  quoteId?: string | null;
  type: string;
  meta?: Record<string, unknown> | null;
}) {
  return prisma.quoteEvent.create({
    data: {
      dealId: input.dealId,
      quoteId: input.quoteId ?? null,
      type: input.type,
      meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function syncDealEstimatedValue(dealId: string, total: number) {
  await prisma.deal.update({
    where: { id: dealId },
    data: { estimatedValue: total },
  });
}
