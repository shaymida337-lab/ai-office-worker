export const DEAL_STAGES = ["open", "quoted", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "rejected", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

export const QUOTE_INCLUDE = {
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: { service: { select: { id: true, name: true, price: true, isActive: true } } },
  },
} as const;

export const DEAL_INCLUDE = {
  lead: { select: { id: true, name: true, phone: true, email: true, whatsapp: true, stage: true } },
  client: { select: { id: true, name: true, email: true, whatsappNumber: true } },
  quotes: {
    orderBy: { version: "desc" as const },
    include: QUOTE_INCLUDE,
  },
} as const;
