import { NATALIE_EMPTY_ANSWER } from "./formatResponse";

export type NormalizedNatalieResponse = {
  answer: string;
  action?: string;
  proposal?: Record<string, unknown>;
  invoices?: Array<Record<string, unknown>>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeInvoice(value: unknown): Record<string, unknown> | null {
  const invoice = asRecord(value);
  if (!invoice) return null;
  const id = asString(invoice.id) ?? `invoice-${Math.random().toString(36).slice(2, 10)}`;
  const amount = asFiniteNumber(invoice.amount) ?? 0;
  return {
    id,
    supplierName: asString(invoice.supplierName),
    invoiceNumber: asString(invoice.invoiceNumber),
    amount,
    currency: asString(invoice.currency) ?? "ILS",
    issueDate: asString(invoice.issueDate) ?? new Date().toISOString(),
    dueDate: asString(invoice.dueDate),
    status: asString(invoice.status) ?? "unknown",
    driveUrl: asString(invoice.driveUrl),
  };
}

export function normalizeNatalieResponse(input: unknown): NormalizedNatalieResponse {
  const payload = asRecord(input);
  if (!payload) return { answer: NATALIE_EMPTY_ANSWER };

  const answer = asString(payload.answer) ?? NATALIE_EMPTY_ANSWER;
  const action = asString(payload.action) ?? undefined;
  const proposal = asRecord(payload.proposal) ?? undefined;
  const invoices = Array.isArray(payload.invoices)
    ? payload.invoices.map(normalizeInvoice).filter((value): value is Record<string, unknown> => Boolean(value))
    : undefined;

  return { answer, action, proposal, invoices };
}

export function normalizeAvailabilityProposal(
  proposal: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!proposal) return undefined;
  const slots = Array.isArray(proposal.slots)
    ? proposal.slots
        .map((slot) => {
          const item = asRecord(slot);
          if (!item) return null;
          const startTime = asString(item.startTime);
          const endTime = asString(item.endTime);
          const label = asString(item.label);
          const durationMinutes = asFiniteNumber(item.durationMinutes);
          if (!startTime || !endTime || !label || !durationMinutes) return null;
          return { startTime, endTime, label, durationMinutes };
        })
        .filter((value): value is { startTime: string; endTime: string; label: string; durationMinutes: number } =>
          Boolean(value)
        )
    : [];
  return { ...proposal, slots };
}

