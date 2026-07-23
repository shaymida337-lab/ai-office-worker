import type { JwtPayload } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { resolveMembershipRole } from "../rbac/membership.js";
import type { PlatformRole } from "../rbac/permissions.js";
import {
  VERIFIED_TENANT_ALLOW_POSITIVE_CACHE_ON_DB_ERROR,
  getVerifiedTenantCacheGeneration,
  getVerifiedTenantInflight,
  invalidateVerifiedTenant,
  peekVerifiedTenantCache,
  setVerifiedTenantInflight,
  setVerifiedTenantNegativeCache,
  setVerifiedTenantPositiveCache,
  type VerifiedTenantCacheSource,
} from "./verifiedTenantCache.js";

export type VerifiedTenant = {
  userId: string;
  organizationId: string;
  email: string;
  role: PlatformRole;
};

/**
 * Request-scoped only (set by validateTenantMiddleware after DB verification).
 * Never populate from client headers/query/body.
 */
export type RequestVerifiedTenant = {
  userId: string;
  organizationId: string;
  role: PlatformRole;
  /** Marker: tenant was verified server-side for this request. */
  verified: true;
};

export type VerifiedTenantFailureReason =
  | "user_not_found"
  | "membership_denied"
  | "stale_organization_token";

export type ResolveVerifiedTenantResult = {
  tenant: VerifiedTenant | null;
  reason?: VerifiedTenantFailureReason;
  cacheSource: VerifiedTenantCacheSource;
  cacheAgeMs: number | null;
  dbMs: number;
};

export function toRequestVerifiedTenant(tenant: VerifiedTenant): RequestVerifiedTenant {
  return {
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    role: tenant.role,
    verified: true,
  };
}

export type ResolveVerifiedTenantDeps = {
  loadFromDb?: (auth: JwtPayload) => Promise<{
    tenant: VerifiedTenant | null;
    reason?: VerifiedTenantFailureReason;
  }>;
};

async function loadVerifiedTenantFromDb(auth: JwtPayload): Promise<{
  tenant: VerifiedTenant | null;
  reason?: VerifiedTenantFailureReason;
}> {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      email: true,
      organization: { select: { id: true } },
    },
  });
  if (!user) {
    return { tenant: null, reason: "user_not_found" };
  }

  const ownedOrganizationId = user.organization?.id ?? null;
  if (ownedOrganizationId && auth.organizationId !== ownedOrganizationId) {
    return { tenant: null, reason: "stale_organization_token" };
  }

  const membership = await resolveMembershipRole(auth.userId, auth.organizationId);
  if (!membership) {
    return { tenant: null, reason: "membership_denied" };
  }

  return {
    tenant: {
      userId: user.id,
      organizationId: membership.organizationId,
      email: user.email,
      role: membership.role,
    },
  };
}

/**
 * Resolve tenant exclusively from authenticated user + DB membership (cached briefly).
 * Never trust organizationId from request body/query/header.
 */
export async function resolveVerifiedTenant(
  auth: JwtPayload,
  deps: ResolveVerifiedTenantDeps = {}
): Promise<ResolveVerifiedTenantResult> {
  const userId = auth.userId;
  const organizationId = auth.organizationId;
  const key = `${userId}\u0000${organizationId}`;
  const loadFromDb = deps.loadFromDb ?? loadVerifiedTenantFromDb;

  const cached = peekVerifiedTenantCache(userId, organizationId);
  if (cached) {
    const ageMs = Math.max(0, Date.now() - cached.loadedAt);
    if (cached.status === "ok") {
      return {
        tenant: {
          userId: cached.userId,
          organizationId: cached.organizationId,
          role: cached.role,
          // Email comes from verified JWT for this request — not stored in cache.
          email: auth.email,
        },
        cacheSource: "hit",
        cacheAgeMs: ageMs,
        dbMs: 0,
      };
    }
    return {
      tenant: null,
      reason: cached.reason,
      cacheSource: "hit",
      cacheAgeMs: ageMs,
      dbMs: 0,
    };
  }

  const existingInflight = getVerifiedTenantInflight<ResolveVerifiedTenantResult>(key);
  if (existingInflight) {
    const shared = await existingInflight;
    return {
      ...shared,
      cacheSource: "inflight",
      // Age relative to shared load; keep dbMs from producer.
    };
  }

  const generationAtStart = getVerifiedTenantCacheGeneration(userId, organizationId);

  const loadPromise = (async (): Promise<ResolveVerifiedTenantResult> => {
    const dbT0 = performance.now();
    try {
      const loaded = await loadFromDb(auth);
      const dbMs = Math.round(performance.now() - dbT0);

      if (loaded.tenant) {
        // Exact match guard before caching.
        if (
          loaded.tenant.userId !== userId ||
          loaded.tenant.organizationId !== organizationId
        ) {
          return {
            tenant: null,
            reason: "membership_denied",
            cacheSource: "miss",
            cacheAgeMs: null,
            dbMs,
          };
        }
        setVerifiedTenantPositiveCache({
          userId: loaded.tenant.userId,
          organizationId: loaded.tenant.organizationId,
          role: loaded.tenant.role,
          generationAtStart,
        });
        return {
          tenant: loaded.tenant,
          cacheSource: "miss",
          cacheAgeMs: null,
          dbMs,
        };
      }

      // Do not positive-cache denials. Short negative TTL for stampede control.
      // stale_organization_token: no cache (security-sensitive).
      if (loaded.reason && loaded.reason !== "stale_organization_token") {
        setVerifiedTenantNegativeCache({
          userId,
          organizationId,
          reason: loaded.reason,
          generationAtStart,
        });
      }

      return {
        tenant: null,
        reason: loaded.reason,
        cacheSource: "miss",
        cacheAgeMs: null,
        dbMs,
      };
    } catch (err) {
      const dbMs = Math.round(performance.now() - dbT0);
      if (VERIFIED_TENANT_ALLOW_POSITIVE_CACHE_ON_DB_ERROR) {
        const fallback = peekVerifiedTenantCache(userId, organizationId);
        if (fallback?.status === "ok") {
          return {
            tenant: {
              userId: fallback.userId,
              organizationId: fallback.organizationId,
              role: fallback.role,
              email: auth.email,
            },
            cacheSource: "hit",
            cacheAgeMs: Math.max(0, Date.now() - fallback.loadedAt),
            dbMs,
          };
        }
      }
      // Never invent a positive cache entry on DB failure.
      throw err;
    }
  })();

  return setVerifiedTenantInflight(key, loadPromise);
}

export { invalidateVerifiedTenant, invalidateVerifiedTenantOrganization } from "./verifiedTenantCache.js";
export { resetVerifiedTenantCacheForTests } from "./verifiedTenantCache.js";
