/**
 * Process-local short TTL cache for resolveVerifiedTenant.
 * Keyed by userId + organizationId only (never by token).
 * No email/PII beyond role + ids.
 */
import type { PlatformRole } from "../rbac/permissions.js";
import type { VerifiedTenantFailureReason } from "./verifiedTenant.js";

export const VERIFIED_TENANT_POSITIVE_TTL_MS = 30_000;
export const VERIFIED_TENANT_NEGATIVE_TTL_MS = 5_000;

/** Explicit policy: on DB failure, reuse only a still-fresh positive entry for the same key. */
export const VERIFIED_TENANT_ALLOW_POSITIVE_CACHE_ON_DB_ERROR = true;

export type VerifiedTenantCacheSource = "hit" | "miss" | "inflight";

type PositiveEntry = {
  status: "ok";
  userId: string;
  organizationId: string;
  role: PlatformRole;
  loadedAt: number;
  expiresAt: number;
};

type NegativeEntry = {
  status: "denied";
  reason: VerifiedTenantFailureReason;
  loadedAt: number;
  expiresAt: number;
};

type CacheEntry = PositiveEntry | NegativeEntry;

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();

export function verifiedTenantCacheKey(userId: string, organizationId: string): string {
  return `${userId}\u0000${organizationId}`;
}

function nowMs(): number {
  return Date.now();
}

function isFresh(entry: CacheEntry, at: number = nowMs()): boolean {
  return entry.expiresAt > at;
}

export function getVerifiedTenantCacheGeneration(userId: string, organizationId: string): number {
  return generation.get(verifiedTenantCacheKey(userId, organizationId)) ?? 0;
}

export function peekVerifiedTenantCache(
  userId: string,
  organizationId: string
): CacheEntry | null {
  const key = verifiedTenantCacheKey(userId, organizationId);
  const entry = store.get(key);
  if (!entry) return null;
  if (!isFresh(entry)) {
    store.delete(key);
    return null;
  }
  // Exact identity match required (defense in depth).
  if (entry.status === "ok") {
    if (entry.userId !== userId || entry.organizationId !== organizationId) {
      store.delete(key);
      return null;
    }
  }
  return entry;
}

export function setVerifiedTenantPositiveCache(input: {
  userId: string;
  organizationId: string;
  role: PlatformRole;
  generationAtStart: number;
  ttlMs?: number;
}): void {
  const key = verifiedTenantCacheKey(input.userId, input.organizationId);
  if ((generation.get(key) ?? 0) !== input.generationAtStart) {
    return; // invalidated while loading
  }
  const loadedAt = nowMs();
  store.set(key, {
    status: "ok",
    userId: input.userId,
    organizationId: input.organizationId,
    role: input.role,
    loadedAt,
    expiresAt: loadedAt + (input.ttlMs ?? VERIFIED_TENANT_POSITIVE_TTL_MS),
  });
}

export function setVerifiedTenantNegativeCache(input: {
  userId: string;
  organizationId: string;
  reason: VerifiedTenantFailureReason;
  generationAtStart: number;
  ttlMs?: number;
}): void {
  const key = verifiedTenantCacheKey(input.userId, input.organizationId);
  if ((generation.get(key) ?? 0) !== input.generationAtStart) {
    return;
  }
  const loadedAt = nowMs();
  store.set(key, {
    status: "denied",
    reason: input.reason,
    loadedAt,
    expiresAt: loadedAt + (input.ttlMs ?? VERIFIED_TENANT_NEGATIVE_TTL_MS),
  });
}

/** Drop cached tenant for this user+org (membership/role/ownership mutations). */
export function invalidateVerifiedTenant(userId: string, organizationId: string): void {
  const key = verifiedTenantCacheKey(userId, organizationId);
  store.delete(key);
  generation.set(key, (generation.get(key) ?? 0) + 1);
}

export function invalidateVerifiedTenantOrganization(organizationId: string): void {
  for (const key of [...store.keys()]) {
    if (key.endsWith(`\u0000${organizationId}`) || key.includes(`\u0000${organizationId}`)) {
      // key format userId\0organizationId
      const parts = key.split("\u0000");
      if (parts[1] === organizationId) {
        store.delete(key);
        generation.set(key, (generation.get(key) ?? 0) + 1);
      }
    }
  }
}

export function getVerifiedTenantInflight<T>(key: string): Promise<T> | undefined {
  return inflight.get(key) as Promise<T> | undefined;
}

export function setVerifiedTenantInflight<T>(key: string, promise: Promise<T>): Promise<T> {
  inflight.set(key, promise);
  // Attach catch on the finally chain so a rejected load does not create an unhandledRejection.
  void promise
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    })
    .catch(() => undefined);
  return promise;
}

export function resetVerifiedTenantCacheForTests(): void {
  store.clear();
  inflight.clear();
  generation.clear();
}

export function verifiedTenantCacheSizeForTests(): number {
  return store.size;
}
