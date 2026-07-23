import { apiFetch, getToken } from "@/lib/api";
import { registerInvoicesListCacheClear } from "@/lib/invoices/invoicesCacheClear";
import { resolveInvoicesIdentityKey } from "@/lib/invoices/invoicesBootstrapStore";

export const INVOICES_LIST_FRESH_MS = 30_000;
export const INVOICES_LIST_TTL_MS = 5 * 60_000;

export type InvoiceListRow = {
  id: string;
  supplierDisplayName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  currency: string;
  status: string;
  reviewStatus: string;
  source: "invoice" | "gmail_scan_item" | "financial_document_review" | "supplier_payment";
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

export type InvoicesListQuery = {
  status?: string;
  clientId?: string;
  search?: string;
  month?: string;
  completeness?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  fromDate?: string;
  toDate?: string;
};

export type InvoicesListCacheSource = "memory" | "network";

type CacheEntry = {
  key: string;
  value: InvoicesListPayload;
  loadedAt: number;
};

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<InvoicesListPayload>>();
let networkCount = 0;
let lastCacheSource: InvoicesListCacheSource | null = null;
let abortByKey = new Map<string, AbortController>();

type FetchList = (url: string) => Promise<InvoicesListPayload>;
type IdentityResolver = () => string;

const defaultFetch: FetchList = (url) => apiFetch<InvoicesListPayload>(url);
const defaultIdentity: IdentityResolver = () => resolveInvoicesIdentityKey(getToken());

let fetchImpl: FetchList = defaultFetch;
let identityImpl: IdentityResolver = defaultIdentity;

function identityPrefix(): string {
  return identityImpl();
}

export type InvoiceSummaryCounts = {
  approvedCount: number;
  needsReviewCount: number;
  incompleteCount: number;
};

/** True when a row still belongs in the active review-status filter. */
export function invoiceMatchesStatusFilter(
  filter: string | undefined,
  reviewStatus: string
): boolean {
  if (!filter || filter === "all") return true;
  return reviewStatus === filter;
}

export function adjustSummaryForReviewStatusChange(
  summary: InvoiceSummaryCounts,
  from: string,
  to: string
): InvoiceSummaryCounts {
  const next = { ...summary };
  if (from === "approved") next.approvedCount = Math.max(0, next.approvedCount - 1);
  if (from === "needs_review") next.needsReviewCount = Math.max(0, next.needsReviewCount - 1);
  if (to === "approved") next.approvedCount += 1;
  if (to === "needs_review") next.needsReviewCount += 1;
  return next;
}

/**
 * Optimistic approve/review update against list cache.
 * Removes the row when it no longer matches the active filter.
 */
export function applyOptimisticReviewStatusChange(
  query: InvoicesListQuery,
  invoiceId: string,
  nextReviewStatus: string
): { removed: boolean; previous: InvoiceListRow | null } {
  const key = buildInvoicesListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) return { removed: false, previous: null };
  const previous = entry.value.invoices.find((row) => row.id === invoiceId) ?? null;
  if (!previous) return { removed: false, previous: null };
  const matches = invoiceMatchesStatusFilter(query.status, nextReviewStatus);
  if (!matches) {
    removeInvoicesListRow(query, invoiceId);
    return { removed: true, previous };
  }
  patchInvoicesListRow(query, invoiceId, {
    reviewStatus: nextReviewStatus,
    status: nextReviewStatus,
    needsReview: nextReviewStatus === "needs_review",
  });
  return { removed: false, previous };
}

export function restoreOptimisticReviewStatusChange(
  query: InvoicesListQuery,
  previous: InvoiceListRow,
  wasRemoved: boolean
): void {
  const key = buildInvoicesListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) {
    memory.set(key, {
      key,
      loadedAt: Date.now(),
      value: {
        invoices: [previous],
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 25,
        total: 1,
        hasMore: false,
        generatedAt: new Date().toISOString(),
      },
    });
    return;
  }
  if (wasRemoved) {
    entry.value = {
      ...entry.value,
      invoices: [previous, ...entry.value.invoices.filter((row) => row.id !== previous.id)],
      total: entry.value.total + 1,
    };
  } else {
    entry.value = {
      ...entry.value,
      invoices: entry.value.invoices.map((row) => (row.id === previous.id ? previous : row)),
    };
  }
  memory.set(key, entry);
}

export function buildInvoicesListCacheKey(query: InvoicesListQuery): string {
  const identity = identityPrefix();
  return [
    identity,
    query.status ?? "all",
    query.clientId ?? "all",
    query.search?.trim() ?? "",
    query.month ?? "",
    query.completeness ?? "complete",
    String(query.page ?? 1),
    String(query.pageSize ?? 25),
    query.sort ?? "date_desc",
    query.fromDate ?? "",
    query.toDate ?? "",
  ].join("|");
}

function buildUrl(query: InvoicesListQuery): string {
  const params = new URLSearchParams();
  params.set("completeness", query.completeness ?? "complete");
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? 25));
  params.set("sort", query.sort ?? "date_desc");
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.clientId && query.clientId !== "all") params.set("clientId", query.clientId);
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.month) params.set("month", query.month);
  return `/api/invoices/list?${params.toString()}`;
}

export function getInvoicesListCacheSource(): InvoicesListCacheSource | null {
  return lastCacheSource;
}

export function getInvoicesListNetworkCount(): number {
  return networkCount;
}

export function invalidateInvoicesList(predicate?: (key: string) => boolean): void {
  if (!predicate) {
    memory.clear();
    inflight.clear();
    for (const controller of abortByKey.values()) controller.abort();
    abortByKey.clear();
    lastCacheSource = null;
    return;
  }
  for (const key of [...memory.keys()]) {
    if (predicate(key)) memory.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (predicate(key)) inflight.delete(key);
  }
}

export function clearInvoicesList(): void {
  invalidateInvoicesList();
}

registerInvoicesListCacheClear(clearInvoicesList);

export function patchInvoicesListRow(
  query: InvoicesListQuery,
  invoiceId: string,
  patch: Partial<InvoiceListRow>
): void {
  const key = buildInvoicesListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) return;
  entry.value = {
    ...entry.value,
    invoices: entry.value.invoices.map((row) => (row.id === invoiceId ? { ...row, ...patch } : row)),
  };
  memory.set(key, entry);
}

export function removeInvoicesListRow(query: InvoicesListQuery, invoiceId: string): void {
  const key = buildInvoicesListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) return;
  entry.value = {
    ...entry.value,
    invoices: entry.value.invoices.filter((row) => row.id !== invoiceId),
    total: Math.max(0, entry.value.total - 1),
  };
  memory.set(key, entry);
}

export async function loadInvoicesList(
  query: InvoicesListQuery,
  options?: { forceNetwork?: boolean; signal?: AbortSignal }
): Promise<InvoicesListPayload> {
  const identity = identityPrefix();
  if (!identity) {
    invalidateInvoicesList();
    throw new Error("Unauthenticated");
  }
  const key = buildInvoicesListCacheKey(query);
  const existing = memory.get(key);
  if (!options?.forceNetwork && existing) {
    const age = Date.now() - existing.loadedAt;
    if (age <= INVOICES_LIST_FRESH_MS) {
      lastCacheSource = "memory";
      return existing.value;
    }
    if (age <= INVOICES_LIST_TTL_MS) {
      lastCacheSource = "memory";
      void refreshInBackground(key, query);
      return existing.value;
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const controller = new AbortController();
  abortByKey.set(key, controller);
  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const promise = (async () => {
    networkCount += 1;
    try {
      const value = await fetchImpl(buildUrl(query));
      memory.set(key, { key, value, loadedAt: Date.now() });
      lastCacheSource = "network";
      return value;
    } catch (err) {
      if (existing) return existing.value;
      throw err;
    } finally {
      inflight.delete(key);
      abortByKey.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

async function refreshInBackground(key: string, query: InvoicesListQuery): Promise<void> {
  if (inflight.has(key)) return;
  const promise = (async () => {
    networkCount += 1;
    try {
      const value = await fetchImpl(buildUrl(query));
      memory.set(key, { key, value, loadedAt: Date.now() });
      lastCacheSource = "network";
      return value;
    } catch {
      return memory.get(key)?.value as InvoicesListPayload;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  await promise;
}

export function __resetInvoicesListStoreForTests(): void {
  memory.clear();
  inflight.clear();
  abortByKey.clear();
  networkCount = 0;
  lastCacheSource = null;
  fetchImpl = defaultFetch;
  identityImpl = defaultIdentity;
}

export function __setInvoicesListFetchForTests(fn: FetchList): void {
  fetchImpl = fn;
}

export function __setInvoicesListIdentityForTests(fn: IdentityResolver): void {
  identityImpl = fn;
}

export function __seedInvoicesListCacheForTests(query: InvoicesListQuery, value: InvoicesListPayload): void {
  const key = buildInvoicesListCacheKey(query);
  memory.set(key, { key, value, loadedAt: Date.now() });
}
