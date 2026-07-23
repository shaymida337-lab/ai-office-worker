/**
 * Process-local invoices bootstrap cache (server-side).
 * Key: userId + organizationId only.
 */
import type { InvoicesBootstrapPayload } from "./invoiceBootstrap.js";

export const INVOICES_BOOTSTRAP_SERVER_FRESH_TTL_MS = 30_000;
export const INVOICES_BOOTSTRAP_SERVER_STALE_TTL_MS = 2 * 60_000;

type CacheEntry = {
  userId: string;
  organizationId: string;
  payload: InvoicesBootstrapPayload;
  loadedAt: number;
  expiresAt: number;
  staleUntil: number;
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();
const orgGeneration = new Map<string, number>();

export function invoicesBootstrapCacheKey(userId: string, organizationId: string): string {
  return `${userId}\u0000${organizationId}`;
}

function nowMs(): number {
  return Date.now();
}

export function getInvoicesBootstrapCacheGeneration(userId: string, organizationId: string): number {
  const key = invoicesBootstrapCacheKey(userId, organizationId);
  return (generation.get(key) ?? 0) + (orgGeneration.get(organizationId) ?? 0) * 1_000_000;
}

export function peekInvoicesBootstrapCache(userId: string, organizationId: string) {
  const key = invoicesBootstrapCacheKey(userId, organizationId);
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

export function setInvoicesBootstrapCache(input: {
  userId: string;
  organizationId: string;
  payload: InvoicesBootstrapPayload;
  generationAtStart: number;
}): void {
  const key = invoicesBootstrapCacheKey(input.userId, input.organizationId);
  if (getInvoicesBootstrapCacheGeneration(input.userId, input.organizationId) !== input.generationAtStart) {
    return;
  }
  const loadedAt = nowMs();
  store.set(key, {
    userId: input.userId,
    organizationId: input.organizationId,
    payload: input.payload,
    loadedAt,
    expiresAt: loadedAt + INVOICES_BOOTSTRAP_SERVER_FRESH_TTL_MS,
    staleUntil: loadedAt + INVOICES_BOOTSTRAP_SERVER_STALE_TTL_MS,
  });
}

export function invalidateInvoicesBootstrap(userId?: string, organizationId?: string): void {
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
    const key = invoicesBootstrapCacheKey(userId, organizationId);
    store.delete(key);
    generation.set(key, (generation.get(key) ?? 0) + 1);
  }
}

export function safeInvalidateInvoicesBootstrap(userId?: string, organizationId?: string): void {
  try {
    invalidateInvoicesBootstrap(userId, organizationId);
  } catch {
    /* mutation must succeed */
  }
}

export function getInvoicesBootstrapInflight<T>(key: string): Promise<T> | undefined {
  return inflight.get(key) as Promise<T> | undefined;
}

export function setInvoicesBootstrapInflight<T>(key: string, promise: Promise<T>): Promise<T> {
  inflight.set(key, promise);
  void promise
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    })
    .catch(() => undefined);
  return promise;
}

export function resetInvoicesBootstrapCacheForTests(): void {
  store.clear();
  inflight.clear();
  generation.clear();
  orgGeneration.clear();
}
