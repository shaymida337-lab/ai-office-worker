import { apiFetch, getToken } from "@/lib/api";
import { registerInvoicesBootstrapCacheClear } from "@/lib/invoices/invoicesCacheClear";

export const INVOICES_BOOTSTRAP_FRESH_MS = 30_000;
export const INVOICES_BOOTSTRAP_TTL_MS = 5 * 60_000;
const SESSION_STORAGE_KEY = "natalie.invoices.bootstrap.v1";

export type InvoicesBootstrapPayload = {
  settings: { timezone: string; locale: string; currency: string };
  filters: { statuses: string[]; documentTypes: string[]; sourceTypes: string[] };
  summary: { approvedCount: number; needsReviewCount: number; incompleteCount: number };
  suppliersPreview: Array<{ id: string; displayName: string }>;
  generatedAt: string;
};

export type InvoicesBootstrapCacheSource = "memory" | "session" | "network";

type CacheEntry = {
  identityKey: string;
  value: InvoicesBootstrapPayload;
  loadedAt: number;
};

type FetchBootstrap = () => Promise<InvoicesBootstrapPayload>;
type IdentityResolver = () => string;

const defaultFetch: FetchBootstrap = () => apiFetch<InvoicesBootstrapPayload>("/api/invoices/bootstrap");

export function resolveInvoicesIdentityKey(token = getToken()): string {
  const raw = token?.trim();
  if (!raw) return "";
  try {
    const parts = raw.split(".");
    if (parts.length < 2) return "";
    const json = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = json + "=".repeat((4 - (json.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { userId?: string; organizationId?: string };
    const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
    const organizationId =
      typeof payload.organizationId === "string" ? payload.organizationId.trim() : "";
    if (!userId || !organizationId) return "";
    return `${userId}:${organizationId}`;
  } catch {
    return "";
  }
}

const defaultIdentity: IdentityResolver = () => resolveInvoicesIdentityKey();

let fetchImpl: FetchBootstrap = defaultFetch;
let identityImpl: IdentityResolver = defaultIdentity;
let cache: CacheEntry | null = null;
let inFlight: { identityKey: string; promise: Promise<InvoicesBootstrapPayload> } | null = null;
let lastCacheSource: InvoicesBootstrapCacheSource | null = null;
let networkCount = 0;

function currentIdentity(): string {
  return identityImpl();
}

function ageMs(entry: CacheEntry): number {
  return Date.now() - entry.loadedAt;
}

function readSession(identityKey: string): CacheEntry | null {
  if (typeof window === "undefined" || !identityKey) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.identityKey || parsed.identityKey !== identityKey || !parsed.value) return null;
    if (typeof parsed.loadedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore quota */
  }
}

function setCache(entry: CacheEntry, source: InvoicesBootstrapCacheSource): void {
  cache = entry;
  lastCacheSource = source;
  writeSession(entry);
}

export function getInvoicesBootstrapCacheSource(): InvoicesBootstrapCacheSource | null {
  return lastCacheSource;
}

export function getInvoicesBootstrapNetworkCount(): number {
  return networkCount;
}

export function invalidateInvoicesBootstrap(): void {
  cache = null;
  inFlight = null;
  lastCacheSource = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function clearInvoicesBootstrap(): void {
  invalidateInvoicesBootstrap();
}

registerInvoicesBootstrapCacheClear(clearInvoicesBootstrap);

export async function loadInvoicesBootstrap(options?: { forceNetwork?: boolean }): Promise<InvoicesBootstrapPayload> {
  const identityKey = currentIdentity();
  if (!identityKey) {
    invalidateInvoicesBootstrap();
    throw new Error("Unauthenticated");
  }

  if (!options?.forceNetwork && cache && cache.identityKey === identityKey) {
    const age = ageMs(cache);
    if (age <= INVOICES_BOOTSTRAP_FRESH_MS) {
      lastCacheSource = "memory";
      return cache.value;
    }
    if (age <= INVOICES_BOOTSTRAP_TTL_MS) {
      lastCacheSource = "memory";
      void refreshInBackground(identityKey);
      return cache.value;
    }
  }

  if (!options?.forceNetwork) {
    const session = readSession(identityKey);
    if (session) {
      const age = ageMs(session);
      if (age <= INVOICES_BOOTSTRAP_TTL_MS) {
        setCache(session, "session");
        if (age > INVOICES_BOOTSTRAP_FRESH_MS) void refreshInBackground(identityKey);
        return session.value;
      }
    }
  }

  if (inFlight && inFlight.identityKey === identityKey) {
    return inFlight.promise;
  }

  const promise = (async () => {
    networkCount += 1;
    const value = await fetchImpl();
    setCache({ identityKey, value, loadedAt: Date.now() }, "network");
    return value;
  })();

  inFlight = { identityKey, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

async function refreshInBackground(identityKey: string): Promise<void> {
  if (inFlight && inFlight.identityKey === identityKey) return;
  const promise = (async () => {
    networkCount += 1;
    try {
      const value = await fetchImpl();
      if (currentIdentity() !== identityKey) return value;
      setCache({ identityKey, value, loadedAt: Date.now() }, "network");
      return value;
    } catch {
      return cache?.value as InvoicesBootstrapPayload;
    }
  })();
  inFlight = { identityKey, promise };
  try {
    await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

export function __resetInvoicesBootstrapStoreForTests(): void {
  cache = null;
  inFlight = null;
  lastCacheSource = null;
  networkCount = 0;
  fetchImpl = defaultFetch;
  identityImpl = defaultIdentity;
}

export function __setInvoicesBootstrapFetchForTests(fn: FetchBootstrap): void {
  fetchImpl = fn;
}

export function __setInvoicesBootstrapIdentityForTests(fn: IdentityResolver): void {
  identityImpl = fn;
}
