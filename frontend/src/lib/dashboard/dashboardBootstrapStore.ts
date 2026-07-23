import { apiFetch, getToken } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import type { DashboardHomeMetricsResponse } from "@/lib/dashboard/homeMetrics";
import { registerDashboardBootstrapCacheClear } from "@/lib/dashboard/dashboardBootstrapCacheClear";
import type { Task } from "@/lib/api";

export const DASHBOARD_BOOTSTRAP_FRESH_MS = 30_000;
export const DASHBOARD_BOOTSTRAP_TTL_MS = 5 * 60_000;
const SESSION_STORAGE_KEY = "natalie.dashboard.bootstrap.v1";

export type DashboardBootstrapGmailStatus = {
  connected: boolean;
  scanning: boolean;
  lastScanAt: string | null;
  googleConfigured: boolean;
  connectedAt: string | null;
};

export type DashboardBootstrapPayload = {
  organizationSettings: OrganizationSettings & { displayName?: string };
  homeMetrics: DashboardHomeMetricsResponse;
  gmailStatus: DashboardBootstrapGmailStatus;
  tasksPreview: Task[];
  generatedAt: string;
};

export type BootstrapCacheSource = "memory" | "session" | "network";

type CacheEntry = {
  identityKey: string;
  value: DashboardBootstrapPayload;
  loadedAt: number;
};

type FetchBootstrap = () => Promise<DashboardBootstrapPayload>;
type IdentityResolver = () => string;

type SessionSnapshot = {
  identityKey: string;
  value: DashboardBootstrapPayload;
  loadedAt: number;
};

const defaultFetch: FetchBootstrap = () => apiFetch<DashboardBootstrapPayload>("/api/dashboard/bootstrap");

/**
 * Cache identity from JWT payload claims — never persist the raw token.
 * Format: userId:organizationId (empty when unauthenticated / undecodable).
 */
export function resolveDashboardBootstrapIdentityKey(token = getToken()): string {
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

const defaultIdentity: IdentityResolver = () => resolveDashboardBootstrapIdentityKey();

let fetchImpl: FetchBootstrap = defaultFetch;
let identityImpl: IdentityResolver = defaultIdentity;
let cache: CacheEntry | null = null;
let inFlight: { identityKey: string; promise: Promise<DashboardBootstrapPayload> } | null = null;
let lastCacheSource: BootstrapCacheSource | null = null;
let networkCount = 0;
let retryCount = 0;
const listeners = new Set<() => void>();

function currentIdentity(): string {
  return identityImpl();
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

function cacheMatches(identityKey: string): boolean {
  return Boolean(cache && identityKey && cache.identityKey === identityKey);
}

function ageMs(entry: CacheEntry): number {
  return Date.now() - entry.loadedAt;
}

function readSessionSnapshot(identityKey: string): CacheEntry | null {
  if (typeof window === "undefined" || !identityKey) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed?.identityKey || parsed.identityKey !== identityKey || !parsed.value) return null;
    if (typeof parsed.loadedAt !== "number") return null;
    return { identityKey: parsed.identityKey, value: parsed.value, loadedAt: parsed.loadedAt };
  } catch {
    return null;
  }
}

function writeSessionSnapshot(entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    const snapshot: SessionSnapshot = {
      identityKey: entry.identityKey,
      value: entry.value,
      loadedAt: entry.loadedAt,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

function clearSessionSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function commitCache(identityKey: string, value: DashboardBootstrapPayload): void {
  if (currentIdentity() !== identityKey) return;
  cache = { identityKey, value, loadedAt: Date.now() };
  writeSessionSnapshot(cache);
  notify();
}

export function subscribeDashboardBootstrap(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedDashboardBootstrap(): DashboardBootstrapPayload | null {
  const identityKey = currentIdentity();
  if (!cacheMatches(identityKey) || !cache) return null;
  return cache.value;
}

export function setDashboardBootstrap(value: DashboardBootstrapPayload): void {
  const identityKey = currentIdentity();
  if (!identityKey) return;
  commitCache(identityKey, value);
}

export function invalidateDashboardBootstrap(): void {
  cache = null;
  inFlight = null;
  clearSessionSnapshot();
  lastCacheSource = null;
  notify();
}

export function clearDashboardBootstrap(): void {
  invalidateDashboardBootstrap();
  networkCount = 0;
  retryCount = 0;
}

registerDashboardBootstrapCacheClear(clearDashboardBootstrap);

async function runFetch(identityKey: string): Promise<DashboardBootstrapPayload> {
  networkCount += 1;
  const value = await fetchImpl();
  commitCache(identityKey, value);
  lastCacheSource = "network";
  return value;
}

function startInFlight(identityKey: string): Promise<DashboardBootstrapPayload> {
  if (inFlight && inFlight.identityKey === identityKey) {
    return inFlight.promise;
  }
  const promise = runFetch(identityKey).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { identityKey, promise };
  return promise;
}

export type LoadDashboardBootstrapOptions = {
  force?: boolean;
};

export type LoadDashboardBootstrapResult = {
  payload: DashboardBootstrapPayload;
  cacheSource: BootstrapCacheSource;
};

/**
 * Shared dashboard bootstrap loader:
 * - fresh (&lt;30s): memory, 0 network
 * - stale (&lt;5m): memory/session immediately + one background refresh
 * - expired / miss: await one network (deduped)
 * - refresh failure keeps prior data
 */
export async function loadDashboardBootstrap(
  options: LoadDashboardBootstrapOptions = {}
): Promise<LoadDashboardBootstrapResult> {
  const identityKey = currentIdentity();
  if (!identityKey) {
    const payload = await startInFlight("");
    return { payload, cacheSource: "network" };
  }

  if (options.force) {
    try {
      const payload = await startInFlight(identityKey);
      return { payload, cacheSource: "network" };
    } catch (err) {
      if (cacheMatches(identityKey) && cache) {
        return { payload: cache.value, cacheSource: lastCacheSource ?? "memory" };
      }
      throw err;
    }
  }

  if (cacheMatches(identityKey) && cache) {
    const age = ageMs(cache);
    if (age < DASHBOARD_BOOTSTRAP_FRESH_MS) {
      lastCacheSource = "memory";
      return { payload: cache.value, cacheSource: "memory" };
    }
    if (age < DASHBOARD_BOOTSTRAP_TTL_MS) {
      lastCacheSource = "memory";
      void startInFlight(identityKey).catch(() => {
        retryCount += 1;
      });
      return { payload: cache.value, cacheSource: "memory" };
    }
  }

  const session = readSessionSnapshot(identityKey);
  if (session) {
    cache = session;
    const age = ageMs(session);
    if (age < DASHBOARD_BOOTSTRAP_TTL_MS) {
      lastCacheSource = "session";
      if (age >= DASHBOARD_BOOTSTRAP_FRESH_MS) {
        void startInFlight(identityKey).catch(() => {
          retryCount += 1;
        });
      }
      return { payload: session.value, cacheSource: "session" };
    }
  }

  try {
    const payload = await startInFlight(identityKey);
    return { payload, cacheSource: "network" };
  } catch (err) {
    if (cacheMatches(identityKey) && cache) {
      return { payload: cache.value, cacheSource: lastCacheSource ?? "memory" };
    }
    const sessionFallback = readSessionSnapshot(identityKey);
    if (sessionFallback) {
      cache = sessionFallback;
      return { payload: sessionFallback.value, cacheSource: "session" };
    }
    throw err;
  }
}

export function getDashboardBootstrapDebugCounters(): {
  networkCount: number;
  retryCount: number;
  lastCacheSource: BootstrapCacheSource | null;
} {
  return { networkCount, retryCount, lastCacheSource };
}

/** @internal */
export function __resetDashboardBootstrapStoreForTests(): void {
  cache = null;
  inFlight = null;
  fetchImpl = defaultFetch;
  identityImpl = defaultIdentity;
  lastCacheSource = null;
  networkCount = 0;
  retryCount = 0;
  listeners.clear();
  clearSessionSnapshot();
}

export function __setDashboardBootstrapFetchForTests(fn: FetchBootstrap | null): void {
  fetchImpl = fn ?? defaultFetch;
}

export function __setDashboardBootstrapIdentityForTests(fn: IdentityResolver | null): void {
  identityImpl = fn ?? defaultIdentity;
}

export function __getDashboardBootstrapStoreSnapshotForTests() {
  return {
    hasCache: Boolean(cache),
    identityKey: cache?.identityKey ?? null,
    loadedAt: cache?.loadedAt ?? null,
    inFlight: Boolean(inFlight),
    networkCount,
    retryCount,
  };
}

/** @internal — rewind cache loadedAt for SWR tests. */
export function __ageDashboardBootstrapCacheForTests(byMs: number): void {
  if (!cache) return;
  cache = { ...cache, loadedAt: cache.loadedAt - byMs };
}

/** @internal — clear memory while leaving sessionStorage snapshot intact. */
export function __dropMemoryCacheKeepSessionForTests(): void {
  cache = null;
  inFlight = null;
  lastCacheSource = null;
}
