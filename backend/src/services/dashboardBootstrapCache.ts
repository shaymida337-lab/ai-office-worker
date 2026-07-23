/**
 * Process-local Dashboard Bootstrap cache (server-side).
 * Key: userId + organizationId only (never token).
 */
import type { DashboardBootstrapPayload } from "../services/dashboardBootstrap.js";

export const DASHBOARD_BOOTSTRAP_SERVER_FRESH_TTL_MS = 30_000;
export const DASHBOARD_BOOTSTRAP_SERVER_STALE_TTL_MS = 2 * 60_000;

export type DashboardBootstrapCacheSource = "hit" | "miss" | "stale" | "inflight" | "bypass";

type CacheEntry = {
  userId: string;
  organizationId: string;
  payload: DashboardBootstrapPayload;
  loadedAt: number;
  expiresAt: number;
  staleUntil: number;
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();
/** Org-scoped generation so mutations invalidate all users in the org. */
const orgGeneration = new Map<string, number>();

export function dashboardBootstrapCacheKey(userId: string, organizationId: string): string {
  return `${userId}\u0000${organizationId}`;
}

function nowMs(): number {
  return Date.now();
}

export function getDashboardBootstrapCacheGeneration(userId: string, organizationId: string): number {
  const key = dashboardBootstrapCacheKey(userId, organizationId);
  return (generation.get(key) ?? 0) + (orgGeneration.get(organizationId) ?? 0) * 1_000_000;
}

export function peekDashboardBootstrapCache(
  userId: string,
  organizationId: string
): { entry: CacheEntry; freshness: "fresh" | "stale" } | null {
  const key = dashboardBootstrapCacheKey(userId, organizationId);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.userId !== userId || entry.organizationId !== organizationId) {
    store.delete(key);
    return null;
  }
  const now = nowMs();
  if (now > entry.staleUntil) {
    store.delete(key);
    return null;
  }
  if (now <= entry.expiresAt) return { entry, freshness: "fresh" };
  return { entry, freshness: "stale" };
}

export function setDashboardBootstrapCache(input: {
  userId: string;
  organizationId: string;
  payload: DashboardBootstrapPayload;
  generationAtStart: number;
}): void {
  const key = dashboardBootstrapCacheKey(input.userId, input.organizationId);
  if (getDashboardBootstrapCacheGeneration(input.userId, input.organizationId) !== input.generationAtStart) {
    return;
  }
  const loadedAt = nowMs();
  store.set(key, {
    userId: input.userId,
    organizationId: input.organizationId,
    payload: input.payload,
    loadedAt,
    expiresAt: loadedAt + DASHBOARD_BOOTSTRAP_SERVER_FRESH_TTL_MS,
    staleUntil: loadedAt + DASHBOARD_BOOTSTRAP_SERVER_STALE_TTL_MS,
  });
}

/** Test helper: age a fresh entry into the stale window (or expire past stale). */
export function ageDashboardBootstrapCacheForTests(
  userId: string,
  organizationId: string,
  ageMs: number
): void {
  const key = dashboardBootstrapCacheKey(userId, organizationId);
  const entry = store.get(key);
  if (!entry) return;
  entry.loadedAt -= ageMs;
  entry.expiresAt -= ageMs;
  entry.staleUntil -= ageMs;
  store.set(key, entry);
}

/**
 * Invalidate dashboard bootstrap for an organization (all users) and optionally one user.
 * Generation bump prevents a late build from repopulating after mutation.
 */
export function invalidateDashboardBootstrap(userId?: string, organizationId?: string): void {
  if (organizationId) {
    orgGeneration.set(organizationId, (orgGeneration.get(organizationId) ?? 0) + 1);
    for (const [key, entry] of store) {
      if (entry.organizationId === organizationId) {
        store.delete(key);
        generation.set(key, (generation.get(key) ?? 0) + 1);
      }
    }
  }
  if (userId && organizationId) {
    const key = dashboardBootstrapCacheKey(userId, organizationId);
    store.delete(key);
    generation.set(key, (generation.get(key) ?? 0) + 1);
  }
}

export function getDashboardBootstrapInflight<T>(key: string): Promise<T> | undefined {
  return inflight.get(key) as Promise<T> | undefined;
}

export function setDashboardBootstrapInflight<T>(key: string, promise: Promise<T>): Promise<T> {
  inflight.set(key, promise);
  void promise
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    })
    .catch(() => undefined);
  return promise;
}

export function resetDashboardBootstrapCacheForTests(): void {
  store.clear();
  inflight.clear();
  generation.clear();
  orgGeneration.clear();
}

export function dashboardBootstrapCacheSizeForTests(): number {
  return store.size;
}

/** Safe fire-and-forget: never throws into callers. */
export function safeInvalidateDashboardBootstrap(userId?: string, organizationId?: string): void {
  try {
    invalidateDashboardBootstrap(userId, organizationId);
  } catch {
    // Mutation must succeed even if cache invalidation fails.
  }
}
