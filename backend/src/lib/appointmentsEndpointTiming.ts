/**
 * Safe timing helpers for GET /api/appointments Server-Timing (gap RCA).
 * Never logs tokens, org ids, appointment ids, PII, query strings, or DATABASE_URL.
 */
import { createHash } from "crypto";

export type AppointmentsEndpointTiming = {
  preRouteMs: number;
  authMs: number;
  /** auth_end → org_start (includes tenant + sync guards). */
  authToOrgMs: number;
  /** validateTenantMiddleware / resolveVerifiedTenant only. */
  tenantMs: number;
  orgMs: number;
  orgToDbMs: number;
  dbMs: number;
  dbToMapMs: number;
  mapMs: number;
  jsonMs: number;
  responseMs: number;
  /** tenant + other post-auth sync middleware before RBAC. */
  middlewareMs: number;
  eventLoopMs: number | null;
  unaccountedMs: number;
  totalMs: number;
  rowCount: number;
  prismaCallCount: number;
  authDbRoundTrips: number;
  /** resolveVerifiedTenant: user lookup + membership (sequential waves). */
  tenantDbRoundTrips: number;
  orgDbRoundTrips: number;
  eventsDbRoundTrips: number;
};

/** Mutually exclusive phases that should sum ≈ total (authToOrg/middleware are aliases, not added twice). */
export function accountedExclusiveMs(t: AppointmentsEndpointTiming): number {
  return (
    t.preRouteMs +
    t.authMs +
    t.tenantMs +
    Math.max(0, t.middlewareMs - t.tenantMs) +
    t.orgMs +
    t.orgToDbMs +
    t.dbMs +
    t.dbToMapMs +
    t.mapMs +
    t.jsonMs +
    t.responseMs
  );
}

export function computeUnaccountedMs(t: Omit<AppointmentsEndpointTiming, "unaccountedMs">): number {
  return Math.max(0, Math.round(t.totalMs - accountedExclusiveMs({ ...t, unaccountedMs: 0 })));
}

export function buildAppointmentsServerTiming(t: AppointmentsEndpointTiming): string {
  return [
    `pre_route;dur=${t.preRouteMs}`,
    `auth;dur=${t.authMs}`,
    `auth_to_org;dur=${t.authToOrgMs}`,
    `tenant;dur=${t.tenantMs}`,
    `org;dur=${t.orgMs}`,
    `org_to_db;dur=${t.orgToDbMs}`,
    `db;dur=${t.dbMs}`,
    `db_to_map;dur=${t.dbToMapMs}`,
    `map;dur=${t.mapMs}`,
    `json;dur=${t.jsonMs}`,
    `response;dur=${t.responseMs}`,
    `middleware;dur=${t.middlewareMs}`,
    `unaccounted;dur=${t.unaccountedMs}`,
    `total;dur=${t.totalMs}`,
  ].join(", ");
}

export function isAppointmentsTimingPath(path: string): boolean {
  return path === "/appointments" || path.endsWith("/appointments");
}

/** Hostname topology only — never returns userinfo, path secrets, or full URL. */
export function safeDatabaseTopology(): {
  neon: boolean;
  pooledHost: boolean;
  neonRegion: string | null;
  hostSuffix: string | null;
  prismaConnectionLimit: string;
  prismaPoolTimeout: string;
  renderRegionEnv: string | null;
  renderServiceHint: string | null;
} {
  const raw = process.env.DATABASE_URL ?? "";
  let neon = false;
  let pooledHost = false;
  let neonRegion: string | null = null;
  let hostSuffix: string | null = null;
  if (raw) {
    try {
      const host = new URL(raw).hostname;
      neon = host.endsWith(".neon.tech");
      pooledHost = host.includes("-pooler");
      const regionMatch = host.match(/\.([a-z]{2}-[a-z]+-\d)\./i);
      neonRegion = regionMatch?.[1] ?? null;
      const parts = host.split(".");
      hostSuffix = parts.length >= 3 ? parts.slice(-3).join(".") : host.split(".").slice(-2).join(".");
    } catch {
      hostSuffix = "invalid-url";
    }
  }
  return {
    neon,
    pooledHost,
    neonRegion,
    hostSuffix,
    prismaConnectionLimit: process.env.PRISMA_CONNECTION_LIMIT ?? "5",
    prismaPoolTimeout: process.env.PRISMA_POOL_TIMEOUT ?? "20",
    renderRegionEnv: process.env.RENDER_REGION ?? process.env.AWS_REGION ?? null,
    renderServiceHint: process.env.RENDER ? "render" : null,
  };
}

export function prismaSingletonActive(prismaExport: unknown, globalPrisma: unknown): boolean {
  return prismaExport != null && prismaExport === globalPrisma;
}

export function timingRequestFingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 10);
}

export function logAppointmentsEndpointTimingSafe(
  t: AppointmentsEndpointTiming,
  extra?: Record<string, string | number | boolean | null>
): void {
  if (process.env.CALENDAR_APPOINTMENTS_TIMING !== "1") return;
  console.info(
    "[calendar/appointments-endpoint timing]",
    JSON.stringify({
      preRouteMs: t.preRouteMs,
      authMs: t.authMs,
      authToOrgMs: t.authToOrgMs,
      tenantMs: t.tenantMs,
      orgMs: t.orgMs,
      orgToDbMs: t.orgToDbMs,
      dbMs: t.dbMs,
      dbToMapMs: t.dbToMapMs,
      mapMs: t.mapMs,
      jsonMs: t.jsonMs,
      responseMs: t.responseMs,
      middlewareMs: t.middlewareMs,
      eventLoopMs: t.eventLoopMs,
      unaccountedMs: t.unaccountedMs,
      totalMs: t.totalMs,
      rowCount: t.rowCount,
      prismaCallCount: t.prismaCallCount,
      authDbRoundTrips: t.authDbRoundTrips,
      tenantDbRoundTrips: t.tenantDbRoundTrips,
      orgDbRoundTrips: t.orgDbRoundTrips,
      eventsDbRoundTrips: t.eventsDbRoundTrips,
      ...extra,
    })
  );
}
