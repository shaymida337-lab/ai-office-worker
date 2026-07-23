/**
 * Slim invoices list projection + pagination helpers.
 * Fetch/merge/completeness stay in the shared invoice list pipeline (parity).
 */
export const INVOICES_LIST_DEFAULT_PAGE_SIZE = 25;
export const INVOICES_LIST_MAX_PAGE_SIZE = 100;
export const INVOICES_LIST_MAX_PAYLOAD_BYTES = 100 * 1024;

export type InvoiceListSource =
  | "invoice"
  | "gmail_scan_item"
  | "financial_document_review"
  | "supplier_payment";

/** Minimal candidate shape required to project a list row (parity fields only). */
export type InvoiceListCandidateLike = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number | null;
  currency: string;
  date: Date;
  status: string;
  reviewStatus: string;
  source: InvoiceListSource;
  reviewSourceId: string | null;
  driveUrl: string | null;
  driveFileUrl: string | null;
  attachmentFilename?: string | null;
  client: { id: string; name: string; color: string | null } | null;
  supplierName: string | null;
  documentType: string | null;
  isComplete: boolean;
  dataComplete: boolean;
  approvalRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
  parsedFieldsJson?: unknown;
  decisionReason?: string | null;
  confidenceScore?: string | number | null;
  fromEmail?: string | null;
  gmailMessageId?: string | null;
  rawAnalysis?: unknown;
};

export type InvoiceListRow = {
  id: string;
  supplierDisplayName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  currency: string;
  status: string;
  reviewStatus: string;
  source: InvoiceListSource;
  hasAttachment: boolean;
  needsReview: boolean;
  approvedAt: string | null;
  clientId: string;
  documentType: string | null;
  driveUrl: string | null;
  isComplete: boolean;
  dataComplete: boolean;
  approvalRequired: boolean;
  reviewSourceId: string | null;
};

export type InvoicesListPayload = {
  invoices: InvoiceListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  generatedAt: string;
};

export type InvoicesListSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export function clampInvoiceListPageSize(raw: number | undefined): number {
  if (!Number.isFinite(raw) || raw == null || raw <= 0) return INVOICES_LIST_DEFAULT_PAGE_SIZE;
  return Math.min(INVOICES_LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(raw)));
}

export function clampInvoiceListPage(raw: number | undefined): number {
  if (!Number.isFinite(raw) || raw == null || raw <= 0) return 1;
  return Math.floor(raw);
}

function toIsoDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

export function mapCandidateToListRow(candidate: InvoiceListCandidateLike): InvoiceListRow {
  const supplierDisplayName =
    (typeof candidate.supplierName === "string" && candidate.supplierName.trim()) ||
    (candidate.client?.name && candidate.client.name.trim()) ||
    null;
  const reviewStatus = candidate.reviewStatus || candidate.status;
  return {
    id: candidate.id,
    supplierDisplayName,
    invoiceNumber: candidate.invoiceNumber,
    issueDate: toIsoDate(candidate.date),
    amount: candidate.amount,
    currency: candidate.currency || "ILS",
    status: candidate.status,
    reviewStatus,
    source: candidate.source,
    hasAttachment: Boolean(candidate.driveUrl || candidate.driveFileUrl || candidate.attachmentFilename),
    needsReview: reviewStatus === "needs_review",
    approvedAt: reviewStatus === "approved" ? toIsoDate(candidate.updatedAt) : null,
    clientId: candidate.clientId || candidate.client?.id || "",
    documentType: candidate.documentType,
    driveUrl: candidate.driveUrl || candidate.driveFileUrl || null,
    isComplete: candidate.isComplete,
    dataComplete: candidate.dataComplete,
    approvalRequired: candidate.approvalRequired,
    reviewSourceId: candidate.reviewSourceId,
  };
}

export function sortInvoiceListCandidates<T extends InvoiceListCandidateLike>(
  rows: T[],
  sort: InvoicesListSort = "date_desc"
): T[] {
  const copy = [...rows];
  switch (sort) {
    case "date_asc":
      return copy.sort((a, b) => a.date.getTime() - b.date.getTime());
    case "amount_desc":
      return copy.sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity));
    case "amount_asc":
      return copy.sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity));
    case "date_desc":
    default:
      return copy.sort(
        (a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
      );
  }
}

export function buildInvoicesListPayload(
  candidates: InvoiceListCandidateLike[],
  input: {
    page?: number;
    pageSize?: number;
    sort?: InvoicesListSort;
    now?: Date;
  }
): InvoicesListPayload {
  const page = clampInvoiceListPage(input.page);
  const pageSize = clampInvoiceListPageSize(input.pageSize);
  const sorted = sortInvoiceListCandidates(candidates, input.sort ?? "date_desc");
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);
  return {
    invoices: pageRows.map(mapCandidateToListRow),
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function assertInvoicesListPayloadBounds(payload: InvoicesListPayload): void {
  if (payload.pageSize > INVOICES_LIST_MAX_PAGE_SIZE) {
    throw new Error(`pageSize ${payload.pageSize} exceeds ${INVOICES_LIST_MAX_PAGE_SIZE}`);
  }
  if (payload.invoices.length > payload.pageSize) {
    throw new Error(`invoices length ${payload.invoices.length} exceeds pageSize ${payload.pageSize}`);
  }
  for (const row of payload.invoices) {
    if (
      "parsedFieldsJson" in row ||
      "rawAnalysis" in row ||
      "decisionReason" in row ||
      "confidenceScore" in row ||
      "fromEmail" in row ||
      "gmailMessageId" in row
    ) {
      throw new Error("list row contains forbidden enrichment fields");
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > INVOICES_LIST_MAX_PAYLOAD_BYTES) {
    throw new Error(`invoices list payload ${bytes} bytes exceeds ${INVOICES_LIST_MAX_PAYLOAD_BYTES}`);
  }
}

export const INVOICES_LIST_FORBIDDEN_RESPONSE_KEYS = [
  "parsedFieldsJson",
  "rawAnalysis",
  "decisionReason",
  "confidenceScore",
  "fromEmail",
  "gmailMessageId",
] as const;
