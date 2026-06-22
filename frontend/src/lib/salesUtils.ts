export const DEAL_STAGES = ["open", "quoted", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  open: "פתוח",
  quoted: "הצעה נשלחה",
  won: "נסגרה",
  lost: "הפסד",
};

export const DEAL_STAGE_TONE: Record<DealStage, string> = {
  open: "border-blue-400/30 bg-blue-400/10 text-blue-100",
  quoted: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  won: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  lost: "border-red-400/30 bg-red-400/10 text-red-100",
};

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "טיוטה",
  sent: "נשלחה",
  viewed: "נצפתה",
  accepted: "אושרה",
  rejected: "נדחתה",
  expired: "פג תוקף",
  superseded: "גרסה ישנה",
};

export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

export type SalesService = {
  id: string;
  name: string;
  durationMinutes: number;
  price?: number | null;
  color?: string | null;
  isActive: boolean;
};

export type QuoteLineDraft = {
  key: string;
  serviceId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

export type SalesDeal = {
  id: string;
  title: string;
  stage: string;
  estimatedValue: number;
  assignedTo: string | null;
  leadId: string | null;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    whatsapp: string | null;
    stage: string;
  } | null;
  client: {
    id: string;
    name: string;
    email: string;
    whatsappNumber: string | null;
  } | null;
  quotes: Array<{
    id: string;
    version: number;
    status: string;
    total: number;
    currency: string;
    validUntil: string | null;
    notes: string | null;
    sentAt: string | null;
    createdAt: string;
    lines: Array<{ id: string; description: string; quantity: number; unitPrice: number }>;
  }>;
};

export type SalesQuote = SalesDeal["quotes"][number];

export function formatIls(amount: number) {
  return `₪${amount.toLocaleString("he-IL")}`;
}

export function latestQuote(deal: SalesDeal) {
  return deal.quotes[0] ?? null;
}

export function quoteBadge(deal: SalesDeal) {
  const quote = latestQuote(deal);
  if (!quote) return null;
  const status = QUOTE_STATUS_LABELS[quote.status] ?? quote.status;
  return `v${quote.version} · ${status}`;
}

export function computeSalesKpis(deals: SalesDeal[]) {
  const openValue = deals
    .filter((deal) => deal.stage === "open" || deal.stage === "quoted")
    .reduce((sum, deal) => sum + deal.estimatedValue, 0);

  const pendingQuotes = deals.filter((deal) => {
    const quote = latestQuote(deal);
    return quote && ["draft", "sent", "viewed"].includes(quote.status);
  }).length;

  const won = deals.filter((deal) => deal.stage === "won").length;
  const lost = deals.filter((deal) => deal.stage === "lost").length;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0;

  return { openValue, pendingQuotes, winRate, total: deals.length };
}

export function dealSubtitle(deal: SalesDeal) {
  if (deal.lead) {
    return deal.lead.phone || deal.lead.email || deal.lead.name;
  }
  if (deal.client) {
    return deal.client.whatsappNumber || deal.client.email || deal.client.name;
  }
  return "עסקה ידנית";
}

export function isDealStage(value: string): value is DealStage {
  return (DEAL_STAGES as readonly string[]).includes(value);
}

export function defaultValidUntilInputValue() {
  const date = new Date();
  date.setDate(date.getDate() + DEFAULT_QUOTE_VALIDITY_DAYS);
  return date.toISOString().slice(0, 10);
}

export function draftQuote(deal: SalesDeal) {
  return deal.quotes.find((quote) => quote.status === "draft") ?? null;
}

export function computeLinesTotal(lines: QuoteLineDraft[]) {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return Math.round(total * 100) / 100;
}

export function linesFromQuote(quote: SalesQuote): QuoteLineDraft[] {
  return quote.lines.map((line, index) => ({
    key: line.id || `line-${index}`,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
}

export function newLineDraft(partial?: Partial<QuoteLineDraft>): QuoteLineDraft {
  return {
    key: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: "",
    quantity: 1,
    unitPrice: 0,
    ...partial,
  };
}

export function validateQuoteDraft(lines: QuoteLineDraft[], validUntil: string): string | null {
  if (!lines.length) return "יש להוסיף לפחות שורה אחת";
  for (const line of lines) {
    if (!line.description.trim()) return "יש למלא תיאור בכל שורה";
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return "כמות חייבת להיות גדולה מאפס";
    if (!Number.isFinite(line.unitPrice) || line.unitPrice <= 0) return "מחיר חייב להיות גדול מאפס";
  }
  const expiry = new Date(validUntil);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    return "תאריך תוקף חייב להיות בעתיד";
  }
  return null;
}

export function quoteLinesPayload(lines: QuoteLineDraft[]) {
  return lines.map((line) => ({
    ...(line.serviceId ? { serviceId: line.serviceId } : {}),
    description: line.description.trim(),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
  }));
}
