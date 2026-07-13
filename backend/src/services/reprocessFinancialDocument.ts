import { prisma } from "../lib/prisma.js";
import { getGoogleClients } from "./google.js";
import {
  fetchAndParseGmailMessageFinancialFields,
  type ParsedGmailFinancialFields,
} from "./gmail-sync.js";
import { isLikelyJunkSupplierName } from "./supplierNameValidation.js";
import { evaluateFreshAmountGateForManualApproval } from "./trust/financeTrustPersistence.js";
import { upsertFinanceGateSnapshot } from "./trust/financeGateSnapshots.js";

const MIN_TRUST_DOCUMENT_YEAR = 2020;
const LOW_OCR_CONFIDENCE_THRESHOLD = 0.5;
const GARBLED_SUPPLIER_CHAR_RATIO = 0.3;
const ALLOWED_SUPPLIER_CHAR = /[\p{Script=Hebrew}a-zA-Z0-9\s]/u;

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
  gmailMessageIdResolvedVia: "direct" | "email_message" | null;
  before: FinancialSnapshot;
  after: FinancialSnapshot;
  wouldChange: boolean;
  trustworthy: boolean;
  skipReason: string | null;
  dryRun: boolean;
  updated: boolean;
  parsedInvoiceNumber: string | null;
};

export type ReprocessTrustContext = {
  ocrConfidence?: number | null;
  amountFromLowConfidenceOcrOnly?: boolean;
};

export type ReprocessParseTrustHints = ReprocessTrustContext;

type LoadedSource = {
  sourceTable: ReprocessSourceTable;
  sourceId: string;
  gmailMessageId: string | null;
  emailMessageId: string | null;
  before: FinancialSnapshot;
};

export type ReprocessFinancialDocumentDeps = {
  prismaClient?: Pick<typeof prisma, "gmailScanItem" | "invoice" | "financialDocumentReview" | "emailMessage">;
  getGoogleClientsFn?: typeof getGoogleClients;
  parseGmailMessage?: (input: {
    organizationId: string;
    gmail: Awaited<ReturnType<typeof getGoogleClients>>["gmail"];
    gmailMessageId: string;
  }) => Promise<ParsedGmailFinancialFields>;
};

export type ReprocessSourceCapability = "direct_gmail" | "resolvable_via_email" | "no_gmail_link";

export function normalizeEmailMessageLookupId(emailMessageId: string) {
  const trimmed = emailMessageId.trim();
  const base = trimmed.split(":")[0]?.trim();
  return base || trimmed;
}

export function emailMessageLookupCandidates(emailMessageId: string | null | undefined) {
  if (!emailMessageId?.trim()) return [] as string[];
  const trimmed = emailMessageId.trim();
  const base = normalizeEmailMessageLookupId(trimmed);
  return base === trimmed ? [trimmed] : [trimmed, base];
}

export function classifyReprocessSourceCapability(
  input: { gmailMessageId?: string | null; emailMessageId?: string | null },
  emailGmailIdByMessageId: Map<string, string | null>
): ReprocessSourceCapability {
  if (input.gmailMessageId?.trim()) return "direct_gmail";
  for (const candidateId of emailMessageLookupCandidates(input.emailMessageId)) {
    const gmailId = emailGmailIdByMessageId.get(candidateId);
    if (gmailId?.trim()) return "resolvable_via_email";
  }
  return "no_gmail_link";
}

export async function loadEmailGmailIdMap(
  db: Pick<typeof prisma, "emailMessage">,
  organizationId: string,
  emailMessageIds: string[]
): Promise<Map<string, string | null>> {
  const lookupIds = [...new Set(emailMessageIds.flatMap((id) => emailMessageLookupCandidates(id)))];
  const map = new Map<string, string | null>();
  if (!lookupIds.length) return map;

  const rows = await db.emailMessage.findMany({
    where: { organizationId, id: { in: lookupIds } },
    select: { id: true, gmailId: true },
  });
  for (const id of lookupIds) map.set(id, null);
  for (const row of rows) map.set(row.id, row.gmailId?.trim() || null);
  return map;
}

export async function resolveGmailMessageIdForReprocess(
  db: Pick<typeof prisma, "emailMessage">,
  input: { organizationId: string; gmailMessageId?: string | null; emailMessageId?: string | null }
): Promise<{ gmailMessageId: string | null; resolvedVia: "direct" | "email_message" | null }> {
  if (input.gmailMessageId?.trim()) {
    return { gmailMessageId: input.gmailMessageId.trim(), resolvedVia: "direct" };
  }

  const emailGmailIdByMessageId = await loadEmailGmailIdMap(
    db,
    input.organizationId,
    emailMessageLookupCandidates(input.emailMessageId)
  );
  if (classifyReprocessSourceCapability(input, emailGmailIdByMessageId) !== "resolvable_via_email") {
    return { gmailMessageId: null, resolvedVia: null };
  }

  for (const candidateId of emailMessageLookupCandidates(input.emailMessageId)) {
    const gmailId = emailGmailIdByMessageId.get(candidateId);
    if (gmailId?.trim()) {
      return { gmailMessageId: gmailId.trim(), resolvedVia: "email_message" };
    }
  }

  return { gmailMessageId: null, resolvedVia: null };
}

function countSourceIds(params: ReprocessFinancialDocumentParams) {
  return [params.gmailScanItemId, params.invoiceId, params.financialDocumentReviewId].filter(Boolean).length;
}

export function reprocessParamsFromRecordId(recordId: string): Pick<
  ReprocessFinancialDocumentParams,
  "gmailScanItemId" | "invoiceId" | "financialDocumentReviewId"
> {
  const id = recordId.trim();
  if (id.startsWith("review_")) {
    return { financialDocumentReviewId: id };
  }
  if (id.startsWith("invoice_")) {
    return { invoiceId: id };
  }
  return { gmailScanItemId: id };
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

function isMissingReprocessSupplier(supplier: string | null | undefined) {
  return !supplier?.trim();
}

function isMissingReprocessAmount(amount: number | null | undefined) {
  return amount == null || amount === 0;
}

function supplierHasGarbledCharacters(supplier: string) {
  const trimmed = supplier.trim();
  if (!trimmed) return false;
  let disallowed = 0;
  for (const char of trimmed) {
    if (!ALLOWED_SUPPLIER_CHAR.test(char)) disallowed++;
  }
  return disallowed / trimmed.length > GARBLED_SUPPLIER_CHAR_RATIO;
}

function isDocumentDateOutOfTrustRange(date: Date | null | undefined) {
  if (!date || Number.isNaN(date.getTime())) return false;
  const year = date.getUTCFullYear();
  const maxYear = new Date().getUTCFullYear() + 1;
  return year < MIN_TRUST_DOCUMENT_YEAR || year > maxYear;
}

function trustContextFromParsed(parsed: ParsedGmailFinancialFields): ReprocessTrustContext {
  const hints = parsed as ParsedGmailFinancialFields & ReprocessParseTrustHints;
  return {
    ocrConfidence: hints.ocrConfidence,
    amountFromLowConfidenceOcrOnly: hints.amountFromLowConfidenceOcrOnly,
  };
}

export function isReprocessResultTrustworthy(
  after: FinancialSnapshot,
  context: ReprocessTrustContext = {}
): { trustworthy: boolean; reason: string } {
  const supplier = after.supplier?.trim() ?? "";

  if (supplier && isLikelyJunkSupplierName(supplier)) {
    return { trustworthy: false, reason: "supplier_still_junk" };
  }

  if (supplier && supplierHasGarbledCharacters(supplier)) {
    return { trustworthy: false, reason: "supplier_garbled_ocr" };
  }

  if (isDocumentDateOutOfTrustRange(after.date)) {
    return { trustworthy: false, reason: "date_out_of_range" };
  }

  if (
    context.amountFromLowConfidenceOcrOnly === true &&
    context.ocrConfidence != null &&
    context.ocrConfidence < LOW_OCR_CONFIDENCE_THRESHOLD
  ) {
    return { trustworthy: false, reason: "low_confidence_ocr_amount" };
  }

  if (isMissingReprocessSupplier(after.supplier) && isMissingReprocessAmount(after.amount)) {
    return { trustworthy: false, reason: "no_improvement" };
  }

  return { trustworthy: true, reason: "" };
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
    case "FinancialDocumentReview": {
      // רענון snapshot של שער הסכום: בלעדיו, ה-UI ממשיך להציג "סכום חסר"
      // גם אחרי ש-totalAmount עודכן — כי תווית השער (amount.arc_missing
      // הישן ב-parsedFieldsJson) גוברת על הערך בתצוגה
      // (frontend presentation.formatDocumentAmount).
      let parsedFieldsUpdate: Record<string, unknown> | undefined;
      if (amount !== undefined) {
        const findUnique = (db.financialDocumentReview as { findUnique?: Function }).findUnique;
        const row = findUnique
          ? await findUnique.call(db.financialDocumentReview, {
              where: { id: source.sourceId },
              select: { parsedFieldsJson: true },
            })
          : null;
        const parsedFields =
          row?.parsedFieldsJson && typeof row.parsedFieldsJson === "object"
            ? (row.parsedFieldsJson as Record<string, unknown>)
            : {};
        const freshAmountGate = evaluateFreshAmountGateForManualApproval({
          parsedFieldsJson: parsedFields,
          totalAmount: amount,
        });
        upsertFinanceGateSnapshot(parsedFields, freshAmountGate);
        parsedFieldsUpdate = parsedFields;
      }
      await db.financialDocumentReview.update({
        where: { id: source.sourceId },
        data: {
          ...(supplier !== undefined ? { supplierName: supplier } : {}),
          ...(amount !== undefined ? { totalAmount: amount } : {}),
          ...(date ? { documentDate: date } : {}),
          ...(parsedFieldsUpdate !== undefined
            ? { parsedFieldsJson: parsedFieldsUpdate as never }
            : {}),
        },
      });
      return;
    }
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
  const resolvedGmail = await resolveGmailMessageIdForReprocess(db, {
    organizationId: params.organizationId,
    gmailMessageId: source.gmailMessageId,
    emailMessageId: source.emailMessageId,
  });
  if (!resolvedGmail.gmailMessageId) {
    throw new Error(
      `Record ${source.sourceTable}:${source.sourceId} has no gmailMessageId and emailMessageId could not be resolved via EmailMessage — cannot re-fetch from Gmail`
    );
  }

  const { gmail } = await getClients(params.organizationId);
  const parsed = await parseGmailMessage({
    organizationId: params.organizationId,
    gmail,
    gmailMessageId: resolvedGmail.gmailMessageId,
  });
  const after = parsedFieldsToSnapshot(parsed);
  const comparison = buildReprocessComparison(source.before, after);
  const trust = isReprocessResultTrustworthy(after, trustContextFromParsed(parsed));
  const skipReason = comparison.wouldChange && !trust.trustworthy ? trust.reason : null;
  const shouldApply = comparison.wouldChange && trust.trustworthy;

  if (!dryRun && shouldApply) {
    await applyInPlaceUpdate(db, source, after);
  }

  return {
    sourceTable: source.sourceTable,
    sourceId: source.sourceId,
    gmailMessageId: resolvedGmail.gmailMessageId,
    emailMessageId: source.emailMessageId,
    gmailMessageIdResolvedVia: resolvedGmail.resolvedVia,
    before: comparison.before,
    after: comparison.after,
    wouldChange: comparison.wouldChange,
    trustworthy: trust.trustworthy,
    skipReason,
    dryRun,
    updated: !dryRun && shouldApply,
    parsedInvoiceNumber: parsed.invoiceNumber,
  };
}
