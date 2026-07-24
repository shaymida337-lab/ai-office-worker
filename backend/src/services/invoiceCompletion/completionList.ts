/**
 * Slim invoice-completion list projection + pagination.
 * Completeness / queue filtering stays in the shared pipeline (parity).
 */
export const COMPLETION_LIST_DEFAULT_PAGE_SIZE = 25;
export const COMPLETION_LIST_MAX_PAGE_SIZE = 100;
export const COMPLETION_LIST_MAX_PAYLOAD_BYTES = 100 * 1024;

export type CompletionListSource =
  | "invoice"
  | "gmail_scan_item"
  | "financial_document_review"
  | "supplier_payment";

export type CompletionListCandidateLike = {
  id: string;
  clientId: string;
  invoiceNumber: string | null;
  amount: number | null;
  currency: string;
  date: Date;
  status: string;
  reviewStatus: string;
  source: CompletionListSource;
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
  missingDataReasons?: string[];
  approvalReasons?: string[];
  canApproveDirectly?: boolean;
  supplierNeedsConfirmation?: boolean;
  approvalBlockReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Fields drawn in the completion queue list (+ minimal action flags, no OCR/body). */
export type CompletionListRow = {
  id: string;
  supplierDisplayName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  currency: string;
  reviewStatus: string;
  missingFields: string[];
  source: CompletionListSource;
  hasAttachment: boolean;
  createdAt: string | null;
  // Minimal action flags for queue buttons (no enrichment bodies).
  clientId: string;
  documentType: string | null;
  driveUrl: string | null;
  dataComplete: boolean;
  approvalRequired: boolean;
  canApproveDirectly?: boolean;
  supplierNeedsConfirmation?: boolean;
  approvalBlockReason?: string | null;
  reviewSourceId: string | null;
  status: string;
};

export type CompletionListPayload = {
  rows: CompletionListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  generatedAt: string;
  /** Present only when source scan hit the hard safety ceiling. */
  truncated?: boolean;
};

export type CompletionListSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export function clampCompletionListPageSize(raw: number | undefined): number {
  if (!Number.isFinite(raw) || raw == null || raw <= 0) return COMPLETION_LIST_DEFAULT_PAGE_SIZE;
  return Math.min(COMPLETION_LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(raw)));
}

export function clampCompletionListPage(raw: number | undefined): number {
  if (!Number.isFinite(raw) || raw == null || raw <= 0) return 1;
  return Math.floor(raw);
}

function toIso(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function mapMissingFields(candidate: CompletionListCandidateLike): string[] {
  const reasons = Array.isArray(candidate.missingDataReasons) ? candidate.missingDataReasons : [];
  const keys = new Set<string>();
  for (const reason of reasons) {
    if (reason.includes("ספק")) keys.add("supplier");
    else if (reason.includes("סכום")) keys.add("amount");
    else if (reason.includes("תאריך")) keys.add("date");
    else if (reason.includes("מטבע")) keys.add("currency");
    else if (reason.includes("סוג מסמך")) keys.add("documentType");
    else keys.add("other");
  }
  return [...keys];
}

export function mapCandidateToCompletionRow(candidate: CompletionListCandidateLike): CompletionListRow {
  const supplierDisplayName =
    (typeof candidate.supplierName === "string" && candidate.supplierName.trim()) ||
    (candidate.client?.name && candidate.client.name.trim()) ||
    null;
  const reviewStatus = candidate.reviewStatus || candidate.status;
  return {
    id: candidate.id,
    supplierDisplayName,
    invoiceNumber: candidate.invoiceNumber,
    issueDate: toIso(candidate.date),
    amount: candidate.amount,
    currency: candidate.currency || "ILS",
    reviewStatus,
    missingFields: mapMissingFields(candidate),
    source: candidate.source,
    hasAttachment: Boolean(candidate.driveUrl || candidate.driveFileUrl || candidate.attachmentFilename),
    createdAt: toIso(candidate.createdAt),
    clientId: candidate.clientId || candidate.client?.id || "",
    documentType: candidate.documentType,
    driveUrl: candidate.driveUrl || candidate.driveFileUrl || null,
    dataComplete: candidate.dataComplete,
    approvalRequired: candidate.approvalRequired,
    canApproveDirectly: candidate.canApproveDirectly,
    supplierNeedsConfirmation: candidate.supplierNeedsConfirmation,
    approvalBlockReason: candidate.approvalBlockReason ?? null,
    reviewSourceId: candidate.reviewSourceId,
    status: candidate.status,
  };
}

export function sortCompletionCandidates<T extends CompletionListCandidateLike>(
  rows: T[],
  sort: CompletionListSort = "date_desc"
): T[] {
  const copy = [...rows];
  const idCmp = (a: CompletionListCandidateLike, b: CompletionListCandidateLike, asc: boolean) => {
    if (a.id === b.id) return 0;
    const less = a.id < b.id;
    if (asc) return less ? -1 : 1;
    return less ? 1 : -1;
  };
  switch (sort) {
    case "date_asc":
      return copy.sort(
        (a, b) =>
          a.date.getTime() - b.date.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          idCmp(a, b, true)
      );
    case "amount_desc":
      return copy.sort(
        (a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || idCmp(a, b, false)
      );
    case "amount_asc":
      return copy.sort(
        (a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity) || idCmp(a, b, true)
      );
    case "date_desc":
    default:
      return copy.sort(
        (a, b) =>
          b.date.getTime() - a.date.getTime() ||
          b.createdAt.getTime() - a.createdAt.getTime() ||
          idCmp(a, b, false)
      );
  }
}

export function sliceCompletionPage<T>(
  candidates: T[],
  input: { page?: number; pageSize?: number; sort?: CompletionListSort }
): { pageRows: T[]; page: number; pageSize: number; total: number; hasMore: boolean; sorted: T[] } {
  const page = clampCompletionListPage(input.page);
  const pageSize = clampCompletionListPageSize(input.pageSize);
  const sorted = sortCompletionCandidates(candidates as CompletionListCandidateLike[], input.sort ?? "date_desc") as T[];
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);
  return {
    pageRows,
    page,
    pageSize,
    total,
    hasMore: start + pageSize < total,
    sorted,
  };
}

export function buildCompletionListPayload(
  pageCandidates: CompletionListCandidateLike[],
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    now?: Date;
    truncated?: boolean;
  }
): CompletionListPayload {
  return {
    rows: pageCandidates.map(mapCandidateToCompletionRow),
    page: meta.page,
    pageSize: meta.pageSize,
    total: meta.total,
    hasMore: meta.hasMore,
    generatedAt: (meta.now ?? new Date()).toISOString(),
    ...(meta.truncated ? { truncated: true } : {}),
  };
}

export const COMPLETION_LIST_FORBIDDEN_RESPONSE_KEYS = [
  "parsedFieldsJson",
  "rawAnalysis",
  "decisionReason",
  "confidenceScore",
  "fromEmail",
  "gmailMessageId",
  "ocrText",
  "histories",
  "timeline",
  "audit",
  "emailBody",
  "attachmentBody",
] as const;

export function assertCompletionListPayloadBounds(payload: CompletionListPayload): void {
  if (payload.pageSize > COMPLETION_LIST_MAX_PAGE_SIZE) {
    throw new Error(`pageSize ${payload.pageSize} exceeds ${COMPLETION_LIST_MAX_PAGE_SIZE}`);
  }
  if (payload.rows.length > payload.pageSize) {
    throw new Error(`rows length ${payload.rows.length} exceeds pageSize ${payload.pageSize}`);
  }
  for (const row of payload.rows) {
    for (const key of COMPLETION_LIST_FORBIDDEN_RESPONSE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        throw new Error(`list row contains forbidden field: ${key}`);
      }
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > COMPLETION_LIST_MAX_PAYLOAD_BYTES) {
    throw new Error(`completion list payload ${bytes} bytes exceeds ${COMPLETION_LIST_MAX_PAYLOAD_BYTES}`);
  }
}

export function filterCompletionCandidatesBySearch<T extends CompletionListCandidateLike>(
  candidates: T[],
  search: string | undefined
): T[] {
  const q = search?.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter((c) => {
    const supplier = (c.supplierName || c.client?.name || "").toLowerCase();
    const inv = (c.invoiceNumber || "").toLowerCase();
    return supplier.includes(q) || inv.includes(q) || c.id.toLowerCase().includes(q);
  });
}

export function filterCompletionCandidatesByStatus<T extends CompletionListCandidateLike>(
  candidates: T[],
  status: string | undefined
): T[] {
  if (!status || status === "all") return candidates;
  return candidates.filter((c) => (c.reviewStatus || c.status) === status);
}
