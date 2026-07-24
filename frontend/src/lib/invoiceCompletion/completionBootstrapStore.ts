import { apiFetch, getToken } from "@/lib/api";
import { registerCompletionBootstrapCacheClear } from "@/lib/invoiceCompletion/completionCacheClear";
import { resolveInvoicesIdentityKey } from "@/lib/invoices/invoicesBootstrapStore";

export const COMPLETION_BOOTSTRAP_FRESH_MS = 30_000;
export const COMPLETION_BOOTSTRAP_TTL_MS = 5 * 60_000;
const SESSION_STORAGE_KEY = "natalie.invoiceCompletion.bootstrap.v1";

export type CompletionBootstrapPayload = {
  counts: {
    incomplete: number;
    byStatus: Record<string, number>;
  };
  availableFilters: {
    statuses: string[];
    sources: string[];
    missingFieldKeys: string[];
  };
  missingFieldCategories: Array<{ key: string; count: number }>;
  generatedAt: string;
  /** True when source scan hit the hard safety ceiling — counts are not org-wide. */
  truncated?: boolean;
};

export type CompletionBootstrapCacheSource = "memory" | "session" | "network";

type CacheEntry = {
  identityKey: string;
  value: CompletionBootstrapPayload;
  loadedAt: number;
};

type FetchBootstrap = () => Promise<CompletionBootstrapPayload>;
type IdentityResolver = () => string;

const defaultFetch: FetchBootstrap = () =>
  apiFetch<CompletionBootstrapPayload>("/api/invoice-completion/bootstrap");

const defaultIdentity: IdentityResolver = () => resolveInvoicesIdentityKey(getToken());

let fetchImpl: FetchBootstrap = defaultFetch;
let identityImpl: IdentityResolver = defaultIdentity;
let cache: CacheEntry | null = null;
let inFlight: { identityKey: string; promise: Promise<CompletionBootstrapPayload> } | null = null;
let lastCacheSource: CompletionBootstrapCacheSource | null = null;
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

function setCache(entry: CacheEntry, source: CompletionBootstrapCacheSource): void {
  cache = entry;
  lastCacheSource = source;
  writeSession(entry);
}

export function getCompletionBootstrapCacheSource(): CompletionBootstrapCacheSource | null {
  return lastCacheSource;
}

export function getCompletionBootstrapNetworkCount(): number {
  return networkCount;
}

export function invalidateCompletionBootstrap(): void {
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

export function clearCompletionBootstrap(): void {
  invalidateCompletionBootstrap();
}

registerCompletionBootstrapCacheClear(clearCompletionBootstrap);

export function patchCompletionBootstrapIncompleteCount(delta: number): void {
  if (!cache) return;
  const incomplete = Math.max(0, cache.value.counts.incomplete + delta);
  cache = {
    ...cache,
    value: {
      ...cache.value,
      counts: {
        ...cache.value.counts,
        incomplete,
      },
    },
  };
  writeSession(cache);
}

export function getCompletionBootstrapSnapshot(): CompletionBootstrapPayload | null {
  return cache?.value ?? null;
}

export async function loadCompletionBootstrap(options?: {
  forceNetwork?: boolean;
}): Promise<CompletionBootstrapPayload> {
  const identityKey = currentIdentity();
  if (!identityKey) {
    invalidateCompletionBootstrap();
    throw new Error("Unauthenticated");
  }

  if (!options?.forceNetwork) {
    if (cache && cache.identityKey === identityKey) {
      const age = ageMs(cache);
      if (age <= COMPLETION_BOOTSTRAP_FRESH_MS) {
        lastCacheSource = "memory";
        return cache.value;
      }
      if (age <= COMPLETION_BOOTSTRAP_TTL_MS) {
        lastCacheSource = "memory";
        void refreshInBackground(identityKey);
        return cache.value;
      }
    }
    const session = readSession(identityKey);
    if (session) {
      const age = ageMs(session);
      if (age <= COMPLETION_BOOTSTRAP_TTL_MS) {
        setCache(session, "session");
        if (age > COMPLETION_BOOTSTRAP_FRESH_MS) void refreshInBackground(identityKey);
        return session.value;
      }
    }
  }

  if (inFlight && inFlight.identityKey === identityKey) return inFlight.promise;

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
      /* keep stale rows/meta */
      return cache?.value as CompletionBootstrapPayload;
    }
  })();
  inFlight = { identityKey, promise };
  try {
    await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/** Test hooks */
export function _setCompletionBootstrapFetchForTests(fn: FetchBootstrap | null): void {
  fetchImpl = fn ?? defaultFetch;
}

export function _setCompletionBootstrapIdentityForTests(fn: IdentityResolver | null): void {
  identityImpl = fn ?? defaultIdentity;
}

export function _resetCompletionBootstrapStoreForTests(): void {
  invalidateCompletionBootstrap();
  networkCount = 0;
  fetchImpl = defaultFetch;
  identityImpl = defaultIdentity;
}
