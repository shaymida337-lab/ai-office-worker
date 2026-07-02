export type InvoiceMonthSummary = {
  year: number;
  month: number;
  count: number;
  totalsByCurrency: Record<string, number>;
};

export type InvoiceGroupingInput = {
  source?: "invoice" | "gmail_scan_item" | "financial_document_review";
  date: string;
  amount: number | null;
  currency: string;
  normalizedDocumentDate?: string | null;
  invoiceDate?: string | null;
  documentDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function monthKeyFromParts(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseGroupingDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function invoiceDateCandidate(invoice: InvoiceGroupingInput): string | null | undefined {
  if (invoice.invoiceDate) return invoice.invoiceDate;
  if (
    !invoice.source ||
    invoice.source === "invoice" ||
    invoice.source === "gmail_scan_item"
  ) {
    return invoice.date;
  }
  return undefined;
}

function documentDateCandidate(invoice: InvoiceGroupingInput): string | null | undefined {
  if (invoice.documentDate) return invoice.documentDate;
  if (invoice.source === "financial_document_review") return invoice.date;
  return undefined;
}

export function resolveInvoiceGroupingDate(invoice: InvoiceGroupingInput): Date | null {
  const candidates = [
    invoice.normalizedDocumentDate,
    invoiceDateCandidate(invoice),
    documentDateCandidate(invoice),
    invoice.createdAt,
    invoice.updatedAt,
  ];

  for (const candidate of candidates) {
    const parsed = parseGroupingDate(candidate ?? undefined);
    if (parsed) return parsed;
  }

  return null;
}

export function buildFallbackMonthGroups<T extends InvoiceGroupingInput>(invoices: T[]) {
  const invoicesByMonth: Record<string, T[]> = {};
  const monthMeta = new Map<string, InvoiceMonthSummary>();

  for (const invoice of invoices) {
    const groupingDate = resolveInvoiceGroupingDate(invoice);
    if (!groupingDate) continue;

    const year = groupingDate.getFullYear();
    const month = groupingDate.getMonth() + 1;
    const key = monthKeyFromParts(year, month);

    if (!invoicesByMonth[key]) invoicesByMonth[key] = [];
    invoicesByMonth[key].push(invoice);

    let summary = monthMeta.get(key);
    if (!summary) {
      summary = { year, month, count: 0, totalsByCurrency: {} };
      monthMeta.set(key, summary);
    }
    summary.count += 1;

    const amount = invoice.amount;
    if (amount != null && Number.isFinite(amount) && amount > 0) {
      const currency = invoice.currency?.trim() || "ILS";
      summary.totalsByCurrency[currency] = (summary.totalsByCurrency[currency] ?? 0) + amount;
    }
  }

  const months = [...monthMeta.values()].sort((a, b) => b.year - a.year || b.month - a.month);
  return { months, invoicesByMonth };
}
