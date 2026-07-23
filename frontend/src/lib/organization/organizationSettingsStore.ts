import { apiFetch, getToken } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { registerOrganizationSettingsCacheClear } from "@/lib/organization/organizationSettingsCacheClear";

/** Fresh window: return cache, no network. */
export const ORGANIZATION_SETTINGS_FRESH_MS = 30_000;
/** Soft TTL: stale-while-revalidate until this age; after that await a fetch. */
export const ORGANIZATION_SETTINGS_TTL_MS = 5 * 60_000;

type CacheEntry = {
  authKey: string;
  value: OrganizationSettings;
  loadedAt: number;
};

type FetchSettings = () => Promise<OrganizationSettings>;
type AuthKeyResolver = () => string;

const defaultFetch: FetchSettings = () =>
  apiFetch<OrganizationSettings>("/api/organization/settings");
const defaultAuthKey: AuthKeyResolver = () => getToken()?.trim() || "";

let fetchSettingsImpl: FetchSettings = defaultFetch;
let authKeyImpl: AuthKeyResolver = defaultAuthKey;
let cache: CacheEntry | null = null;
let inFlight: { authKey: string; promise: Promise<OrganizationSettings> } | null = null;
const listeners = new Set<() => void>();

function currentAuthKey(): string {
  return authKeyImpl();
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function cacheMatchesAuth(authKey: string): boolean {
  return Boolean(cache && authKey && cache.authKey === authKey);
}

function cacheAgeMs(entry: CacheEntry): number {
  return Date.now() - entry.loadedAt;
}

export function subscribeOrganizationSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sync read of the shared cache (auth-scoped). */
export function getCachedOrganizationSettings(): OrganizationSettings | null {
  const authKey = currentAuthKey();
  if (!cacheMatchesAuth(authKey) || !cache) return null;
  return cache.value;
}

/** Write-through after PUT/save — bypasses TTL so header/dashboard update immediately. */
export function setOrganizationSettingsCache(value: OrganizationSettings): void {
  const authKey = currentAuthKey();
  cache = {
    authKey,
    value,
    loadedAt: Date.now(),
  };
  notify();
}

export function clearOrganizationSettingsCache(): void {
  cache = null;
  inFlight = null;
  notify();
}

// Register eagerly so logout/saveToken can clear synchronously (no async import race).
registerOrganizationSettingsCacheClear(clearOrganizationSettingsCache);

async function runFetch(authKey: string): Promise<OrganizationSettings> {
  const value = await fetchSettingsImpl();
  // Commit only if the same auth session is still active (org isolation).
  if (currentAuthKey() === authKey) {
    cache = { authKey, value, loadedAt: Date.now() };
    notify();
  }
  return value;
}

function startInFlight(authKey: string): Promise<OrganizationSettings> {
  if (inFlight && inFlight.authKey === authKey) {
    return inFlight.promise;
  }
  const promise = runFetch(authKey).finally(() => {
    if (inFlight?.promise === promise) {
      inFlight = null;
    }
  });
  inFlight = { authKey, promise };
  return promise;
}

export type LoadOrganizationSettingsOptions = {
  /** Always hit the network (still deduped with other in-flight callers). */
  force?: boolean;
};

/**
 * Shared organization settings loader:
 * - dedupes in-flight GETs
 * - fresh (&lt;30s): cache only
 * - stale (&lt;5m): return cache, revalidate in background
 * - expired / miss: await network
 * - refresh failure keeps prior cache
 */
export async function loadOrganizationSettings(
  options: LoadOrganizationSettingsOptions = {}
): Promise<OrganizationSettings> {
  const authKey = currentAuthKey();
  if (!authKey) {
    // Unauthenticated: still dedupe concurrent anonymous callers on "".
    return startInFlight("");
  }

  if (options.force) {
    try {
      return await startInFlight(authKey);
    } catch (err) {
      if (cacheMatchesAuth(authKey) && cache) return cache.value;
      throw err;
    }
  }

  if (cacheMatchesAuth(authKey) && cache) {
    const age = cacheAgeMs(cache);
    if (age < ORGANIZATION_SETTINGS_FRESH_MS) {
      return cache.value;
    }
    if (age < ORGANIZATION_SETTINGS_TTL_MS) {
      void startInFlight(authKey).catch(() => undefined);
      return cache.value;
    }
  }

  try {
    return await startInFlight(authKey);
  } catch (err) {
    if (cacheMatchesAuth(authKey) && cache) return cache.value;
    throw err;
  }
}

/** @internal test helpers */
export function __resetOrganizationSettingsStoreForTests(): void {
  cache = null;
  inFlight = null;
  fetchSettingsImpl = defaultFetch;
  authKeyImpl = defaultAuthKey;
  listeners.clear();
}

export function __setOrganizationSettingsFetchForTests(fn: FetchSettings | null): void {
  fetchSettingsImpl = fn ?? defaultFetch;
}

export function __setOrganizationSettingsAuthKeyForTests(fn: AuthKeyResolver | null): void {
  authKeyImpl = fn ?? defaultAuthKey;
}

export function __getOrganizationSettingsStoreSnapshotForTests(): {
  hasCache: boolean;
  authKey: string | null;
  loadedAt: number | null;
  inFlight: boolean;
} {
  return {
    hasCache: Boolean(cache),
    authKey: cache?.authKey ?? null,
    loadedAt: cache?.loadedAt ?? null,
    inFlight: Boolean(inFlight),
  };
}
