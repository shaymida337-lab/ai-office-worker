/**
 * Safe timing helpers for GET /api/appointments Server-Timing.
 * Never logs tokens, org ids, appointment ids, PII, query strings, or DATABASE_URL.
 */
import { createHash } from "crypto";

export type AppointmentsEndpointTiming = {
  requestReceivedAt: number;
  authMs: number;
  orgMs: number;
  dbMs: number;
  mapMs: number;
  serializeMs: number;
  totalMs: number;
  /** Included in dbMs when not separately measurable via Prisma. */
  poolWaitMs: number | null;
  rowCount: number;
  prismaCallCount: number;
  authDbRoundTrips: number;
  orgDbRoundTrips: number;
  eventsDbRoundTrips: number;
};

export function buildAppointmentsServerTiming(t: AppointmentsEndpointTiming): string {
  const parts = [
    `auth;dur=${t.authMs}`,
    `org;dur=${t.orgMs}`,
    `db;dur=${t.dbMs}`,
    `map;dur=${t.mapMs}`,
    `serialize;dur=${t.serializeMs}`,
    `total;dur=${t.totalMs}`,
  ];
  if (t.poolWaitMs != null) {
    parts.splice(3, 0, `pool;dur=${t.poolWaitMs}`);
  }
  return parts.join(", ");
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

/** Fingerprint for correlating logs without leaking ids (optional). */
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
      authMs: t.authMs,
      orgMs: t.orgMs,
      dbMs: t.dbMs,
      mapMs: t.mapMs,
      serializeMs: t.serializeMs,
      totalMs: t.totalMs,
      poolWaitMs: t.poolWaitMs,
      rowCount: t.rowCount,
      prismaCallCount: t.prismaCallCount,
      authDbRoundTrips: t.authDbRoundTrips,
      orgDbRoundTrips: t.orgDbRoundTrips,
      eventsDbRoundTrips: t.eventsDbRoundTrips,
      ...extra,
    })
  );
}
