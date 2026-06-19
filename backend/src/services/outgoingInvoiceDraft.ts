import type { OutgoingInvoiceDraft } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type InvoiceDraftInput = {
  customerName: string;
  customerEmail?: string;
  customerTaxId?: string;
  clientId?: string;
  description: string;
  amount: number;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
};

export type ValidatedInvoiceDraftInput = InvoiceDraftInput & {
  customerName: string;
  description: string;
  amount: number;
};

export type InvoiceDraftValidationResult =
  | { ok: true; value: ValidatedInvoiceDraftInput }
  | { ok: false; reason: string };

export const INVOICE_DRAFT_SAVED_CONFIRMATION_MESSAGE =
  "✅ הטיוטה נשמרה. זו טיוטה פנימית בלבד — לא הונפקה חשבונית מס רשמית.";

export function validateInvoiceDraftInput(input: unknown): InvoiceDraftValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "customer name required" };
  }

  const body = input as Record<string, unknown>;
  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  if (!customerName) {
    return { ok: false, reason: "customer name required" };
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return { ok: false, reason: "description required" };
  }

  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "amount must be positive" };
  }

  const optionalStringFields = ["customerEmail", "customerTaxId", "currency", "issueDate", "dueDate", "clientId"] as const;
  for (const field of optionalStringFields) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return { ok: false, reason: `${field} must be a string` };
    }
  }

  return {
    ok: true,
    value: {
      customerName,
      description,
      amount,
      ...(typeof body.customerEmail === "string" ? { customerEmail: body.customerEmail } : {}),
      ...(typeof body.customerTaxId === "string" ? { customerTaxId: body.customerTaxId } : {}),
      ...(typeof body.clientId === "string" ? { clientId: body.clientId } : {}),
      ...(typeof body.currency === "string" ? { currency: body.currency } : {}),
      ...(typeof body.issueDate === "string" ? { issueDate: body.issueDate } : {}),
      ...(typeof body.dueDate === "string" ? { dueDate: body.dueDate } : {}),
    },
  };
}

function parseOptionalDate(value?: string) {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterValidInvoiceDrafts(drafts: InvoiceDraftInput[]): ValidatedInvoiceDraftInput[] {
  const valid: ValidatedInvoiceDraftInput[] = [];
  for (const draft of drafts) {
    const validation = validateInvoiceDraftInput(draft);
    if (validation.ok) valid.push(validation.value);
  }
  return valid;
}

export async function saveInvoiceDraftsBatch(input: {
  organizationId: string;
  drafts: InvoiceDraftInput[];
}): Promise<{ savedCount: number; draftIds: string[] }> {
  const validDrafts = filterValidInvoiceDrafts(input.drafts);
  const draftIds: string[] = [];
  const approvedAt = new Date();

  for (const draft of validDrafts) {
    const issueDate = parseOptionalDate(draft.issueDate);
    const dueDate = parseOptionalDate(draft.dueDate);
    const saved = await prisma.outgoingInvoiceDraft.create({
      data: {
        organizationId: input.organizationId,
        status: "draft",
        source: "import",
        customerName: draft.customerName,
        customerEmail: draft.customerEmail ?? null,
        customerTaxId: draft.customerTaxId ?? null,
        clientId: draft.clientId ?? null,
        description: draft.description,
        amount: draft.amount,
        currency: draft.currency ?? "ILS",
        issueDate,
        dueDate,
        proposalJson: draft,
        approvedAt,
      },
    });
    draftIds.push(saved.id);
  }

  return { savedCount: draftIds.length, draftIds };
}

export async function saveInvoiceDraft(input: {
  organizationId: string;
  draft: ValidatedInvoiceDraftInput;
}) {
  const { organizationId, draft } = input;
  const issueDate = parseOptionalDate(draft.issueDate);
  const dueDate = parseOptionalDate(draft.dueDate);

  return prisma.outgoingInvoiceDraft.create({
    data: {
      organizationId,
      status: "draft",
      source: "natalie",
      customerName: draft.customerName,
      customerEmail: draft.customerEmail ?? null,
      customerTaxId: draft.customerTaxId ?? null,
      clientId: draft.clientId ?? null,
      description: draft.description,
      amount: draft.amount,
      currency: draft.currency ?? "ILS",
      issueDate,
      dueDate,
      proposalJson: draft,
      approvedAt: new Date(),
    },
  });
}

export async function listOutgoingInvoiceDrafts(input: {
  organizationId: string;
}): Promise<OutgoingInvoiceDraft[]> {
  return prisma.outgoingInvoiceDraft.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteOutgoingInvoiceDraft(input: {
  organizationId: string;
  id: string;
}): Promise<{ deleted: boolean }> {
  const result = await prisma.outgoingInvoiceDraft.deleteMany({
    where: { id: input.id, organizationId: input.organizationId },
  });
  return { deleted: result.count > 0 };
}
