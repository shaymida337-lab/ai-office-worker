import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  DEFAULT_QUOTE_VALIDITY_DAYS,
  QUOTE_INCLUDE,
  QUOTE_STATUSES,
  type QuoteStatus,
} from "./salesConstants.js";
import { logQuoteEvent, syncDealEstimatedValue } from "./quoteEvents.js";
import { getDeal } from "./dealService.js";

export { QUOTE_STATUSES };

export type QuoteLineInput = {
  serviceId?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
};

export type CreateQuoteInput = {
  lines: QuoteLineInput[];
  validUntil?: string | Date | null;
  notes?: string | null;
  currency?: string | null;
};

export type UpdateQuoteInput = {
  lines?: QuoteLineInput[];
  validUntil?: string | Date | null;
  notes?: string | null;
};

type NormalizedQuoteLine = {
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
};

export function computeQuoteTotals(lines: Array<{ quantity: number; unitPrice: number }>) {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return {
    subtotal: roundMoney(subtotal),
    total: roundMoney(subtotal),
  };
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function parseQuantity(value: unknown): number | null {
  const quantity = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return quantity;
}

function parseUnitPrice(value: unknown): number | null {
  const unitPrice = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return unitPrice;
}

function parseValidUntil(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function defaultValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + DEFAULT_QUOTE_VALIDITY_DAYS);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function validateQuoteLineInput(input: QuoteLineInput): { ok: true; value: Omit<NormalizedQuoteLine, "sortOrder"> } | { ok: false; reason: string } {
  const serviceId = typeof input.serviceId === "string" && input.serviceId.trim() ? input.serviceId.trim() : null;
  const quantity = parseQuantity(input.quantity ?? 1);
  if (quantity == null) {
    return { ok: false, reason: "quantity must be positive" };
  }

  let unitPrice: number | null = null;
  if (input.unitPrice !== undefined && input.unitPrice !== null && input.unitPrice !== "") {
    unitPrice = parseUnitPrice(input.unitPrice);
    if (unitPrice == null) {
      return { ok: false, reason: "unitPrice must be positive" };
    }
  } else if (!serviceId) {
    return { ok: false, reason: "unitPrice must be positive" };
  }

  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description && !serviceId) {
    return { ok: false, reason: "description or serviceId required" };
  }

  return {
    ok: true,
    value: {
      serviceId,
      description,
      quantity,
      unitPrice: unitPrice ?? 0,
    },
  };
}

async function normalizeQuoteLines(
  organizationId: string,
  lines: QuoteLineInput[]
): Promise<NormalizedQuoteLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("At least one quote line is required");
  }

  const normalized: NormalizedQuoteLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const validated = validateQuoteLineInput(lines[index]!);
    if (!validated.ok) {
      throw new Error(validated.reason);
    }

    let { serviceId, description, quantity, unitPrice } = validated.value;

    if (serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: serviceId, organizationId, isActive: true },
      });
      if (!service) {
        throw new Error("Service not found or inactive");
      }
      if (!description) {
        description = service.name;
      }
      if (unitPrice <= 0) {
        if (service.price == null || service.price <= 0) {
          throw new Error("Service has no valid price");
        }
        unitPrice = service.price;
      }
    }

    if (!description.trim()) {
      throw new Error("description is required");
    }

    normalized.push({
      serviceId,
      description: description.trim(),
      quantity,
      unitPrice,
      sortOrder: index,
    });
  }

  return normalized;
}

async function supersedePreviousQuotes(dealId: string, organizationId: string) {
  await prisma.quote.updateMany({
    where: {
      dealId,
      organizationId,
      status: { in: ["draft", "sent", "viewed"] },
    },
    data: {
      status: "superseded",
      approvalToken: null,
    },
  });
}

async function getNextQuoteVersion(dealId: string) {
  const latest = await prisma.quote.findFirst({
    where: { dealId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

export async function createQuoteForDeal(organizationId: string, dealId: string, input: CreateQuoteInput) {
  await getDeal(organizationId, dealId);

  const lines = await normalizeQuoteLines(organizationId, input.lines);
  const totals = computeQuoteTotals(lines);
  const validUntil = parseValidUntil(input.validUntil) ?? defaultValidUntil();
  if (validUntil.getTime() <= Date.now()) {
    throw new Error("validUntil must be in the future");
  }

  const version = await getNextQuoteVersion(dealId);
  if (version > 1) {
    await supersedePreviousQuotes(dealId, organizationId);
  }

  const quote = await prisma.$transaction(async (tx) => {
    const created = await tx.quote.create({
      data: {
        organizationId,
        dealId,
        version,
        status: "draft",
        validUntil,
        subtotal: totals.subtotal,
        total: totals.total,
        currency: typeof input.currency === "string" && input.currency.trim() ? input.currency.trim() : "ILS",
        notes: typeof input.notes === "string" ? input.notes.trim() || null : null,
        lines: {
          create: lines.map((line) => ({
            serviceId: line.serviceId,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            sortOrder: line.sortOrder,
          })),
        },
      },
      include: QUOTE_INCLUDE,
    });

    await tx.deal.update({
      where: { id: dealId },
      data: { stage: "quoted", estimatedValue: totals.total },
    });

    return created;
  });

  await logQuoteEvent({
    dealId,
    quoteId: quote.id,
    type: "quote_created",
    meta: { version, total: totals.total },
  });

  return quote;
}

export async function getQuote(organizationId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId },
    include: QUOTE_INCLUDE,
  });
  if (!quote) {
    throw new Error("Quote not found");
  }
  return quote;
}

export async function listQuotesForDeal(organizationId: string, dealId: string) {
  await getDeal(organizationId, dealId);
  return prisma.quote.findMany({
    where: { organizationId, dealId },
    include: QUOTE_INCLUDE,
    orderBy: { version: "desc" },
  });
}

export async function updateQuote(organizationId: string, quoteId: string, input: UpdateQuoteInput) {
  const existing = await getQuote(organizationId, quoteId);
  if (existing.status !== "draft") {
    throw new Error("Only draft quotes can be edited");
  }

  const lines = input.lines ? await normalizeQuoteLines(organizationId, input.lines) : null;
  const totals = lines ? computeQuoteTotals(lines) : null;

  if (input.validUntil !== undefined) {
    const validUntil = parseValidUntil(input.validUntil);
    if (!validUntil || validUntil.getTime() <= Date.now()) {
      throw new Error("validUntil must be in the future");
    }
  }

  const quote = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.quoteLine.deleteMany({ where: { quoteId } });
    }

    const updated = await tx.quote.update({
      where: { id: quoteId },
      data: {
        ...(lines
          ? {
              subtotal: totals!.subtotal,
              total: totals!.total,
              lines: {
                create: lines.map((line) => ({
                  serviceId: line.serviceId,
                  description: line.description,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  sortOrder: line.sortOrder,
                })),
              },
            }
          : {}),
        ...(input.validUntil !== undefined ? { validUntil: parseValidUntil(input.validUntil) } : {}),
        ...(input.notes !== undefined
          ? { notes: typeof input.notes === "string" ? input.notes.trim() || null : null }
          : {}),
      },
      include: QUOTE_INCLUDE,
    });

    if (totals) {
      await tx.deal.update({
        where: { id: existing.dealId },
        data: { estimatedValue: totals.total },
      });
    }

    return updated;
  });

  await logQuoteEvent({
    dealId: existing.dealId,
    quoteId,
    type: "quote_updated",
    meta: totals ? { total: totals.total } : undefined,
  });

  return quote;
}

export function isQuoteStatus(value: string): value is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

export async function updateQuoteStatus(
  organizationId: string,
  quoteId: string,
  status: string,
  extra?: Prisma.QuoteUpdateInput
) {
  if (!isQuoteStatus(status)) {
    throw new Error("Invalid quote status");
  }

  const existing = await getQuote(organizationId, quoteId);
  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: { status, ...extra },
    include: QUOTE_INCLUDE,
  });

  await logQuoteEvent({
    dealId: existing.dealId,
    quoteId,
    type: "quote_status_changed",
    meta: { from: existing.status, to: status },
  });

  if (status === "accepted") {
    await syncDealEstimatedValue(existing.dealId, existing.total);
  }

  return quote;
}
