/**
 * Invoices screen First Paint bootstrap — meta only (no invoice rows).
 * No Google API / Drive API. Verified tenant resolved by middleware once.
 */
import { prisma } from "../../lib/prisma.js";
import { DEFAULT_TIMEZONE } from "../calendar/rules.js";
import { getDocumentReviewsHomeSummary } from "../documentReviewsHomeSummary.js";

export const INVOICES_BOOTSTRAP_MAX_PAYLOAD_BYTES = 50 * 1024;
export const INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT = 50;

export const INVOICE_FILTER_STATUSES = ["all", "approved", "needs_review", "rejected"] as const;
export const INVOICE_FILTER_DOCUMENT_TYPES = [
  "tax_invoice",
  "receipt",
  "tax_invoice_receipt",
  "invoice",
  "unknown_needs_review",
] as const;
export const INVOICE_FILTER_SOURCE_TYPES = [
  "invoice",
  "gmail_scan_item",
  "financial_document_review",
  "supplier_payment",
] as const;

export type InvoicesBootstrapPayload = {
  settings: {
    timezone: string;
    locale: string;
    currency: string;
  };
  filters: {
    statuses: readonly string[];
    documentTypes: readonly string[];
    sourceTypes: readonly string[];
  };
  summary: {
    approvedCount: number;
    needsReviewCount: number;
    incompleteCount: number;
  };
  suppliersPreview: Array<{ id: string; displayName: string }>;
  generatedAt: string;
};

export type InvoicesBootstrapTiming = {
  settingsMs: number;
  summaryMs: number;
  suppliersMs: number;
  serializeMs: number;
  totalMs: number;
  organizationLookupCount: number;
  queryGroupCount: number;
};

async function timedMs<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
}

async function loadSettings(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, locale: true, currency: true },
  });
  if (!org) throw new Error("Organization not found");
  return {
    timezone: org.timezone?.trim() || DEFAULT_TIMEZONE,
    locale: org.locale?.trim() || "he-IL",
    currency: org.currency?.trim() || "ILS",
  };
}

/**
 * Summary counts use bounded Prisma counts + home summary — not the unbounded
 * months materialization used by legacy GET /invoices/months?completeness=incomplete.
 */
async function loadSummary(organizationId: string) {
  const [approvedInvoices, approvedPayments, needsReviewSummary, incompleteReviews, incompleteGsi] =
    await Promise.all([
      prisma.invoice.count({ where: { organizationId } }),
      prisma.supplierPayment.count({
        where: {
          organizationId,
          approvalStatus: "approved",
          documentTypeDetailed: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
        },
      }),
      getDocumentReviewsHomeSummary({ organizationId, status: "needs_review" }),
      prisma.financialDocumentReview.count({
        where: {
          organizationId,
          reviewStatus: "needs_review",
          documentType: { in: ["tax_invoice", "receipt", "tax_invoice_receipt"] },
        },
      }),
      prisma.gmailScanItem.count({
        where: {
          organizationId,
          reviewStatus: "needs_review",
          documentType: { in: ["invoice", "receipt", "unknown_needs_review"] },
        },
      }),
    ]);

  return {
    approvedCount: approvedInvoices + approvedPayments,
    needsReviewCount: needsReviewSummary.count,
    incompleteCount: incompleteReviews + incompleteGsi,
  };
}

async function loadSuppliersPreview(organizationId: string) {
  const clients = await prisma.client.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: "asc" },
    take: INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT,
    select: { id: true, name: true },
  });
  return clients.map((c) => ({
    id: c.id,
    displayName: typeof c.name === "string" && c.name.trim() ? c.name.trim() : "ללא שם",
  }));
}

export async function getInvoicesBootstrap(
  organizationId: string,
  options?: { collectTiming?: boolean; onTiming?: (t: InvoicesBootstrapTiming) => void; now?: Date }
): Promise<InvoicesBootstrapPayload> {
  const now = options?.now ?? new Date();
  const collect = Boolean(options?.collectTiming || options?.onTiming);
  const totalT0 = performance.now();

  const settingsP = collect ? timedMs(() => loadSettings(organizationId)) : loadSettings(organizationId).then((v) => ({ value: v, ms: 0 }));
  const summaryP = collect ? timedMs(() => loadSummary(organizationId)) : loadSummary(organizationId).then((v) => ({ value: v, ms: 0 }));
  const suppliersP = collect
    ? timedMs(() => loadSuppliersPreview(organizationId))
    : loadSuppliersPreview(organizationId).then((v) => ({ value: v, ms: 0 }));

  const [settingsTimed, summaryTimed, suppliersTimed] = await Promise.all([settingsP, summaryP, suppliersP]);

  const serializeT0 = performance.now();
  const payload: InvoicesBootstrapPayload = {
    settings: settingsTimed.value,
    filters: {
      statuses: [...INVOICE_FILTER_STATUSES],
      documentTypes: [...INVOICE_FILTER_DOCUMENT_TYPES],
      sourceTypes: [...INVOICE_FILTER_SOURCE_TYPES],
    },
    summary: summaryTimed.value,
    suppliersPreview: suppliersTimed.value,
    generatedAt: now.toISOString(),
  };
  const serializeMs = Math.round(performance.now() - serializeT0);

  if (collect) {
    const timing: InvoicesBootstrapTiming = {
      settingsMs: settingsTimed.ms,
      summaryMs: summaryTimed.ms,
      suppliersMs: suppliersTimed.ms,
      serializeMs,
      totalMs: Math.round(performance.now() - totalT0),
      organizationLookupCount: 1,
      queryGroupCount: 3,
    };
    options?.onTiming?.(timing);
  }

  return payload;
}

export function assertInvoicesBootstrapPayloadBounds(payload: InvoicesBootstrapPayload): void {
  if (payload.suppliersPreview.length > INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT) {
    throw new Error(
      `suppliersPreview length ${payload.suppliersPreview.length} exceeds ${INVOICES_BOOTSTRAP_SUPPLIERS_PREVIEW_LIMIT}`
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > INVOICES_BOOTSTRAP_MAX_PAYLOAD_BYTES) {
    throw new Error(`invoices bootstrap payload ${bytes} bytes exceeds ${INVOICES_BOOTSTRAP_MAX_PAYLOAD_BYTES}`);
  }
}

export const INVOICES_BOOTSTRAP_FORBIDDEN_MARKERS = [
  "ensureGmailAccessToken",
  "googleapis",
  "drive.google",
  "resolveGmailConnectionStatus",
] as const;
