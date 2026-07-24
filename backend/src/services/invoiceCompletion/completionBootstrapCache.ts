/**
 * Process-local invoice-completion bootstrap cache (server-side).
 * Key: userId + organizationId only.
 */
import type { CompletionBootstrapPayload } from "./completionBootstrap.js";

export const COMPLETION_BOOTSTRAP_SERVER_FRESH_TTL_MS = 30_000;
export const COMPLETION_BOOTSTRAP_SERVER_STALE_TTL_MS = 2 * 60_000;

type CacheEntry = {
  userId: string;
  organizationId: string;
  payload: CompletionBootstrapPayload;
  loadedAt: number;
  expiresAt: number;
  staleUntil: number;
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();
const orgGeneration = new Map<string, number>();

export function completionBootstrapCacheKey(userId: string, organizationId: string): string {
  return `${userId}\u0000${organizationId}`;
}

function nowMs(): number {
  return Date.now();
}

export function getCompletionBootstrapCacheGeneration(userId: string, organizationId: string): number {
  const key = completionBootstrapCacheKey(userId, organizationId);
  return (generation.get(key) ?? 0) + (orgGeneration.get(organizationId) ?? 0) * 1_000_000;
}

export function peekCompletionBootstrapCache(userId: string, organizationId: string) {
  const key = completionBootstrapCacheKey(userId, organizationId);
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
  if (now <= entry.expiresAt) return { entry, freshness: "fresh" as const };
  return { entry, freshness: "stale" as const };
}

export function setCompletionBootstrapCache(input: {
  userId: string;
  organizationId: string;
  payload: CompletionBootstrapPayload;
  generationAtStart: number;
}): void {
  const key = completionBootstrapCacheKey(input.userId, input.organizationId);
  if (getCompletionBootstrapCacheGeneration(input.userId, input.organizationId) !== input.generationAtStart) {
    return;
  }
  const loadedAt = nowMs();
  store.set(key, {
    userId: input.userId,
    organizationId: input.organizationId,
    payload: input.payload,
    loadedAt,
    expiresAt: loadedAt + COMPLETION_BOOTSTRAP_SERVER_FRESH_TTL_MS,
    staleUntil: loadedAt + COMPLETION_BOOTSTRAP_SERVER_STALE_TTL_MS,
  });
}

export function invalidateCompletionBootstrap(userId?: string, organizationId?: string): void {
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
    const key = completionBootstrapCacheKey(userId, organizationId);
    store.delete(key);
    generation.set(key, (generation.get(key) ?? 0) + 1);
  }
}

export function safeInvalidateCompletionBootstrap(userId?: string, organizationId?: string): void {
  try {
    invalidateCompletionBootstrap(userId, organizationId);
  } catch {
    /* mutation must succeed */
  }
}

export function getCompletionBootstrapInflight<T>(key: string): Promise<T> | undefined {
  return inflight.get(key) as Promise<T> | undefined;
}

export function setCompletionBootstrapInflight<T>(key: string, promise: Promise<T>): Promise<T> {
  inflight.set(key, promise);
  promise.finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  return promise;
}

/** Test helper */
export function _resetCompletionBootstrapCacheForTests(): void {
  store.clear();
  inflight.clear();
  generation.clear();
  orgGeneration.clear();
}
