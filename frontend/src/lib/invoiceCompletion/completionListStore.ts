import { apiFetch, getToken } from "@/lib/api";
import { registerCompletionListCacheClear } from "@/lib/invoiceCompletion/completionCacheClear";
import { resolveInvoicesIdentityKey } from "@/lib/invoices/invoicesBootstrapStore";
import { patchCompletionBootstrapIncompleteCount } from "@/lib/invoiceCompletion/completionBootstrapStore";

export const COMPLETION_LIST_FRESH_MS = 30_000;
export const COMPLETION_LIST_TTL_MS = 5 * 60_000;
const SESSION_STORAGE_PREFIX = "natalie.invoiceCompletion.list.v1:";

export type CompletionListRow = {
  id: string;
  supplierDisplayName: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  amount: number | null;
  currency: string;
  reviewStatus: string;
  missingFields: string[];
  source: "invoice" | "gmail_scan_item" | "financial_document_review" | "supplier_payment";
  hasAttachment: boolean;
  createdAt: string | null;
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
  /** True when source scan hit the hard safety ceiling — total is not org-wide. */
  truncated?: boolean;
};

export type CompletionListQuery = {
  status?: string;
  clientId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
};

export type CompletionListCacheSource = "memory" | "session" | "network";

type CacheEntry = {
  key: string;
  value: CompletionListPayload;
  loadedAt: number;
};

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CompletionListPayload>>();
let networkCount = 0;
let lastCacheSource: CompletionListCacheSource | null = null;

type FetchList = (url: string) => Promise<CompletionListPayload>;
type IdentityResolver = () => string;

const defaultFetch: FetchList = (url) => apiFetch<CompletionListPayload>(url);
const defaultIdentity: IdentityResolver = () => resolveInvoicesIdentityKey(getToken());

let fetchImpl: FetchList = defaultFetch;
let identityImpl: IdentityResolver = defaultIdentity;

function identityPrefix(): string {
  return identityImpl();
}

export function buildCompletionListCacheKey(query: CompletionListQuery): string {
  const identity = identityPrefix();
  return [
    identity,
    query.status ?? "all",
    query.clientId ?? "all",
    query.search?.trim() ?? "",
    String(query.page ?? 1),
    String(query.pageSize ?? 25),
    query.sort ?? "date_desc",
  ].join("|");
}

function buildUrl(query: CompletionListQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? 25));
  params.set("sort", query.sort ?? "date_desc");
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.clientId && query.clientId !== "all") params.set("clientId", query.clientId);
  if (query.search?.trim()) params.set("search", query.search.trim());
  return `/api/invoice-completion/list?${params.toString()}`;
}

function sessionKey(cacheKey: string): string {
  return `${SESSION_STORAGE_PREFIX}${cacheKey}`;
}

function readSession(cacheKey: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(sessionKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.key || parsed.key !== cacheKey || !parsed.value) return null;
    if (typeof parsed.loadedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(sessionKey(entry.key), JSON.stringify(entry));
  } catch {
    /* ignore quota */
  }
}

function removeSession(cacheKey: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(sessionKey(cacheKey));
  } catch {
    /* ignore */
  }
}

export function getCompletionListCacheSource(): CompletionListCacheSource | null {
  return lastCacheSource;
}

export function getCompletionListNetworkCount(): number {
  return networkCount;
}

export function invalidateCompletionList(predicate?: (key: string) => boolean): void {
  if (!predicate) {
    for (const key of memory.keys()) removeSession(key);
    memory.clear();
    inflight.clear();
    lastCacheSource = null;
    return;
  }
  for (const key of [...memory.keys()]) {
    if (predicate(key)) {
      memory.delete(key);
      removeSession(key);
    }
  }
  for (const key of [...inflight.keys()]) {
    if (predicate(key)) inflight.delete(key);
  }
}

export function clearCompletionList(): void {
  invalidateCompletionList();
}

registerCompletionListCacheClear(clearCompletionList);

export function patchCompletionListRow(
  query: CompletionListQuery,
  invoiceId: string,
  patch: Partial<CompletionListRow>
): void {
  const key = buildCompletionListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) return;
  entry.value = {
    ...entry.value,
    rows: entry.value.rows.map((row) => (row.id === invoiceId ? { ...row, ...patch } : row)),
  };
  memory.set(key, entry);
  writeSession(entry);
}

export function removeCompletionListRow(query: CompletionListQuery, invoiceId: string): boolean {
  const key = buildCompletionListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) return false;
  const before = entry.value.rows.length;
  const rows = entry.value.rows.filter((row) => row.id !== invoiceId);
  if (rows.length === before) return false;
  entry.value = {
    ...entry.value,
    rows,
    total: Math.max(0, entry.value.total - 1),
  };
  memory.set(key, entry);
  writeSession(entry);
  patchCompletionBootstrapIncompleteCount(-1);
  return true;
}

export function restoreCompletionListRow(query: CompletionListQuery, previous: CompletionListRow): void {
  const key = buildCompletionListCacheKey(query);
  const entry = memory.get(key);
  if (!entry) {
    const value: CompletionListPayload = {
      rows: [previous],
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
      total: 1,
      hasMore: false,
      generatedAt: new Date().toISOString(),
    };
    const next = { key, value, loadedAt: Date.now() };
    memory.set(key, next);
    writeSession(next);
    patchCompletionBootstrapIncompleteCount(1);
    return;
  }
  if (entry.value.rows.some((row) => row.id === previous.id)) return;
  entry.value = {
    ...entry.value,
    rows: [previous, ...entry.value.rows],
    total: entry.value.total + 1,
  };
  memory.set(key, entry);
  writeSession(entry);
  patchCompletionBootstrapIncompleteCount(1);
}

export async function loadCompletionList(
  query: CompletionListQuery,
  options?: { forceNetwork?: boolean }
): Promise<CompletionListPayload> {
  const identity = identityPrefix();
  if (!identity) {
    invalidateCompletionList();
    throw new Error("Unauthenticated");
  }
  const key = buildCompletionListCacheKey(query);
  const existing = memory.get(key);
  if (!options?.forceNetwork && existing) {
    const age = Date.now() - existing.loadedAt;
    if (age <= COMPLETION_LIST_FRESH_MS) {
      lastCacheSource = "memory";
      return existing.value;
    }
    if (age <= COMPLETION_LIST_TTL_MS) {
      lastCacheSource = "memory";
      void refreshInBackground(key, query);
      return existing.value;
    }
  }

  if (!options?.forceNetwork) {
    const session = readSession(key);
    if (session) {
      const age = Date.now() - session.loadedAt;
      if (age <= COMPLETION_LIST_TTL_MS) {
        memory.set(key, session);
        lastCacheSource = "session";
        if (age > COMPLETION_LIST_FRESH_MS) void refreshInBackground(key, query);
        return session.value;
      }
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    networkCount += 1;
    lastCacheSource = "network";
    try {
      const value = await fetchImpl(buildUrl(query));
      const entry = { key, value, loadedAt: Date.now() };
      memory.set(key, entry);
      writeSession(entry);
      return value;
    } catch (err) {
      const stale = memory.get(key);
      if (stale) {
        lastCacheSource = "memory";
        return stale.value;
      }
      throw err;
    }
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inflight.get(key) === promise) inflight.delete(key);
  }
}

async function refreshInBackground(key: string, query: CompletionListQuery): Promise<void> {
  if (inflight.has(key)) return;
  const promise = (async () => {
    networkCount += 1;
    try {
      const value = await fetchImpl(buildUrl(query));
      const entry = { key, value, loadedAt: Date.now() };
      memory.set(key, entry);
      writeSession(entry);
      return value;
    } catch {
      const stale = memory.get(key);
      return stale?.value as CompletionListPayload;
    }
  })();
  inflight.set(key, promise);
  try {
    await promise;
  } finally {
    if (inflight.get(key) === promise) inflight.delete(key);
  }
}

/** Test hooks */
export function _setCompletionListFetchForTests(fn: FetchList | null): void {
  fetchImpl = fn ?? defaultFetch;
}

export function _setCompletionListIdentityForTests(fn: IdentityResolver | null): void {
  identityImpl = fn ?? defaultIdentity;
}

export function _resetCompletionListStoreForTests(): void {
  invalidateCompletionList();
  networkCount = 0;
  fetchImpl = defaultFetch;
  identityImpl = defaultIdentity;
}
