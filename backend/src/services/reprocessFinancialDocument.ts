import { prisma } from "../lib/prisma.js";
import { getGoogleClients } from "./google.js";
import {
  fetchAndParseGmailMessageFinancialFields,
  type ParsedGmailFinancialFields,
} from "./gmail-sync.js";

export type FinancialSnapshot = {
  supplier: string | null;
  amount: number | null;
  date: Date | null;
};

export type ReprocessSourceTable = "GmailScanItem" | "Invoice" | "FinancialDocumentReview";

export type ReprocessFinancialDocumentParams = {
  organizationId: string;
  gmailScanItemId?: string;
  invoiceId?: string;
  financialDocumentReviewId?: string;
  dryRun?: boolean;
};

export type ReprocessFinancialDocumentResult = {
  sourceTable: ReprocessSourceTable;
  sourceId: string;
  gmailMessageId: string | null;
  emailMessageId: string | null;
  before: FinancialSnapshot;
  after: FinancialSnapshot;
  wouldChange: boolean;
  dryRun: boolean;
  updated: boolean;
  parsedInvoiceNumber: string | null;
};

type LoadedSource = {
  sourceTable: ReprocessSourceTable;
  sourceId: string;
  gmailMessageId: string | null;
  emailMessageId: string | null;
  before: FinancialSnapshot;
};

export type ReprocessFinancialDocumentDeps = {
  prismaClient?: Pick<typeof prisma, "gmailScanItem" | "invoice" | "financialDocumentReview">;
  getGoogleClientsFn?: typeof getGoogleClients;
  parseGmailMessage?: (input: {
    organizationId: string;
    gmail: Awaited<ReturnType<typeof getGoogleClients>>["gmail"];
    gmailMessageId: string;
  }) => Promise<ParsedGmailFinancialFields>;
};

function countSourceIds(params: ReprocessFinancialDocumentParams) {
  return [params.gmailScanItemId, params.invoiceId, params.financialDocumentReviewId].filter(Boolean).length;
}

function normalizeSnapshotAmount(amount: number | null | undefined) {
  return amount == null || !Number.isFinite(amount) ? null : amount;
}

function normalizeSnapshotDate(date: Date | null | undefined) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

export function buildFinancialSnapshot(input: {
  supplier?: string | null;
  amount?: number | null;
  date?: Date | null;
}): FinancialSnapshot {
  return {
    supplier: input.supplier?.trim() ? input.supplier.trim() : null,
    amount: normalizeSnapshotAmount(input.amount ?? null),
    date: normalizeSnapshotDate(input.date ?? null),
  };
}

export function financialSnapshotsEqual(before: FinancialSnapshot, after: FinancialSnapshot) {
  const beforeSupplier = (before.supplier ?? "").trim();
  const afterSupplier = (after.supplier ?? "").trim();
  if (beforeSupplier !== afterSupplier) return false;

  if (before.amount !== after.amount) {
    if (before.amount == null && after.amount == null) {
      // equal
    } else {
      return false;
    }
  }

  const beforeDate = before.date?.toISOString().slice(0, 10) ?? null;
  const afterDate = after.date?.toISOString().slice(0, 10) ?? null;
  return beforeDate === afterDate;
}

export function buildReprocessComparison(before: FinancialSnapshot, after: FinancialSnapshot) {
  return {
    before,
    after,
    wouldChange: !financialSnapshotsEqual(before, after),
  };
}

function parsedFieldsToSnapshot(parsed: ParsedGmailFinancialFields): FinancialSnapshot {
  return buildFinancialSnapshot({
    supplier: parsed.supplierName,
    amount: parsed.finalTotalAmount ?? parsed.amount,
    date: parsed.documentDate,
  });
}

async function loadSourceRecord(
  db: Pick<typeof prisma, "gmailScanItem" | "invoice" | "financialDocumentReview">,
  params: ReprocessFinancialDocumentParams
): Promise<LoadedSource> {
  const sourceCount = countSourceIds(params);
  if (sourceCount !== 1) {
    throw new Error("Provide exactly one of gmailScanItemId, invoiceId, or financialDocumentReviewId");
  }

  if (params.gmailScanItemId) {
    const row = await db.gmailScanItem.findFirst({
      where: { id: params.gmailScanItemId, organizationId: params.organizationId },
      select: {
        id: true,
        gmailMessageId: true,
        emailMessageId: true,
        supplierName: true,
        amount: true,
        occurredAt: true,
      },
    });
    if (!row) throw new Error(`GmailScanItem not found: ${params.gmailScanItemId}`);
    return {
      sourceTable: "GmailScanItem",
      sourceId: row.id,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailMessageId,
      before: buildFinancialSnapshot({
        supplier: row.supplierName,
        amount: row.amount,
        date: row.occurredAt,
      }),
    };
  }

  if (params.invoiceId) {
    const row = await db.invoice.findFirst({
      where: { id: params.invoiceId, organizationId: params.organizationId },
      select: {
        id: true,
        gmailMessageId: true,
        emailId: true,
        supplierName: true,
        amount: true,
        date: true,
      },
    });
    if (!row) throw new Error(`Invoice not found: ${params.invoiceId}`);
    return {
      sourceTable: "Invoice",
      sourceId: row.id,
      gmailMessageId: row.gmailMessageId,
      emailMessageId: row.emailId,
      before: buildFinancialSnapshot({
        supplier: row.supplierName,
        amount: row.amount,
        date: row.date,
      }),
    };
  }

  const reviewId = params.financialDocumentReviewId!;
  const row = await db.financialDocumentReview.findFirst({
    where: { id: reviewId, organizationId: params.organizationId },
    select: {
      id: true,
      gmailMessageId: true,
      emailMessageId: true,
      supplierName: true,
      totalAmount: true,
      documentDate: true,
    },
  });
  if (!row) throw new Error(`FinancialDocumentReview not found: ${reviewId}`);
  return {
    sourceTable: "FinancialDocumentReview",
    sourceId: row.id,
    gmailMessageId: row.gmailMessageId,
    emailMessageId: row.emailMessageId,
    before: buildFinancialSnapshot({
      supplier: row.supplierName,
      amount: row.totalAmount,
      date: row.documentDate,
    }),
  };
}

async function applyInPlaceUpdate(
  db: Pick<typeof prisma, "gmailScanItem" | "invoice" | "financialDocumentReview">,
  source: LoadedSource,
  after: FinancialSnapshot
) {
  const supplier = after.supplier ?? undefined;
  const amount = after.amount ?? undefined;
  const date = after.date ?? undefined;

  switch (source.sourceTable) {
    case "GmailScanItem":
      await db.gmailScanItem.update({
        where: { id: source.sourceId },
        data: {
          ...(supplier !== undefined ? { supplierName: supplier } : {}),
          ...(amount !== undefined ? { amount } : {}),
          ...(date ? { occurredAt: date } : {}),
        },
      });
      return;
    case "Invoice":
      await db.invoice.update({
        where: { id: source.sourceId },
        data: {
          ...(supplier !== undefined ? { supplierName: supplier } : {}),
          ...(amount !== undefined ? { amount } : {}),
          ...(date ? { date } : {}),
        },
      });
      return;
    case "FinancialDocumentReview":
      await db.financialDocumentReview.update({
        where: { id: source.sourceId },
        data: {
          ...(supplier !== undefined ? { supplierName: supplier } : {}),
          ...(amount !== undefined ? { totalAmount: amount } : {}),
          ...(date ? { documentDate: date } : {}),
        },
      });
      return;
  }
}

export async function reprocessFinancialDocumentBySource(
  params: ReprocessFinancialDocumentParams,
  deps: ReprocessFinancialDocumentDeps = {}
): Promise<ReprocessFinancialDocumentResult> {
  const dryRun = params.dryRun !== false;
  const db = deps.prismaClient ?? prisma;
  const getClients = deps.getGoogleClientsFn ?? getGoogleClients;
  const parseGmailMessage = deps.parseGmailMessage ?? fetchAndParseGmailMessageFinancialFields;

  const source = await loadSourceRecord(db, params);
  if (!source.gmailMessageId) {
    throw new Error(`Record ${source.sourceTable}:${source.sourceId} has no gmailMessageId — cannot re-fetch from Gmail`);
  }

  const { gmail } = await getClients(params.organizationId);
  const parsed = await parseGmailMessage({
    organizationId: params.organizationId,
    gmail,
    gmailMessageId: source.gmailMessageId,
  });
  const after = parsedFieldsToSnapshot(parsed);
  const comparison = buildReprocessComparison(source.before, after);

  if (!dryRun) {
    await applyInPlaceUpdate(db, source, after);
  }

  return {
    sourceTable: source.sourceTable,
    sourceId: source.sourceId,
    gmailMessageId: source.gmailMessageId,
    emailMessageId: source.emailMessageId,
    before: comparison.before,
    after: comparison.after,
    wouldChange: comparison.wouldChange,
    dryRun,
    updated: !dryRun && comparison.wouldChange,
    parsedInvoiceNumber: parsed.invoiceNumber,
  };
}
