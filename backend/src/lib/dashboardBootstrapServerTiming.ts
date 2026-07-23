/**
 * Safe Server-Timing helpers for GET /api/dashboard/bootstrap.
 * No tokens, org/user ids, PII, bodies, or secrets in logs/headers.
 */
export type DashboardBootstrapEndpointTiming = {
  preRouteMs: number;
  authMs: number;
  tenantMs: number;
  tenantDbMs: number;
  organizationResolutionMs: number;
  settingsMs: number;
  homeMetricsMs: number;
  gmailStatusMs: number;
  tasksMs: number;
  queryWaitMs: number;
  mapMs: number;
  serializeMs: number;
  responseMs: number;
  middlewareMs: number;
  unaccountedMs: number;
  totalMs: number;
  tenantDbRoundTrips: number;
  orgLookupCount: number;
  bootstrapCacheSource: "hit" | "miss" | "stale" | "inflight" | "bypass";
  bootstrapCacheAgeMs: number | null;
  bootstrapBuildMs: number;
};

export function accountedExclusiveMs(t: DashboardBootstrapEndpointTiming): number {
  // gmail∥tasks overlap: count wall as max for exclusive accounting; Server-Timing still reports both.
  const gmailTasksWall = Math.max(t.gmailStatusMs, t.tasksMs);
  return (
    t.preRouteMs +
    t.authMs +
    t.tenantMs +
    Math.max(0, t.middlewareMs - t.tenantMs) +
    t.organizationResolutionMs +
    t.settingsMs +
    t.homeMetricsMs +
    gmailTasksWall +
    t.queryWaitMs +
    t.mapMs +
    t.serializeMs +
    t.responseMs
  );
}

export function computeUnaccountedMs(
  t: Omit<DashboardBootstrapEndpointTiming, "unaccountedMs">
): number {
  return Math.max(0, Math.round(t.totalMs - accountedExclusiveMs({ ...t, unaccountedMs: 0 })));
}

export function buildDashboardBootstrapServerTiming(t: DashboardBootstrapEndpointTiming): string {
  return [
    `pre_route;dur=${t.preRouteMs}`,
    `auth;dur=${t.authMs}`,
    `tenant;dur=${t.tenantMs}`,
    `tenant_db;dur=${t.tenantDbMs}`,
    `organization_resolution;dur=${t.organizationResolutionMs}`,
    `settings;dur=${t.settingsMs}`,
    `home_metrics;dur=${t.homeMetricsMs}`,
    `gmail_status;dur=${t.gmailStatusMs}`,
    `tasks;dur=${t.tasksMs}`,
    `query_wait;dur=${t.queryWaitMs}`,
    `map;dur=${t.mapMs}`,
    `serialize;dur=${t.serializeMs}`,
    `response;dur=${t.responseMs}`,
    `middleware;dur=${t.middlewareMs}`,
    `unaccounted;dur=${t.unaccountedMs}`,
    `total;dur=${t.totalMs}`,
  ].join(", ");
}

export function isDashboardBootstrapTimingPath(path: string): boolean {
  return path === "/dashboard/bootstrap" || path.endsWith("/dashboard/bootstrap");
}

export function logDashboardBootstrapTimingSafe(
  t: DashboardBootstrapEndpointTiming,
  extra?: Record<string, string | number | boolean | null>
): void {
  if (process.env.DASHBOARD_BOOTSTRAP_TIMING !== "1") return;
  console.info(
    "[dashboard/bootstrap timing]",
    JSON.stringify({
      preRouteMs: t.preRouteMs,
      authMs: t.authMs,
      tenantMs: t.tenantMs,
      tenantDbMs: t.tenantDbMs,
      organizationResolutionMs: t.organizationResolutionMs,
      settingsMs: t.settingsMs,
      homeMetricsMs: t.homeMetricsMs,
      gmailStatusMs: t.gmailStatusMs,
      tasksMs: t.tasksMs,
      queryWaitMs: t.queryWaitMs,
      mapMs: t.mapMs,
      serializeMs: t.serializeMs,
      responseMs: t.responseMs,
      middlewareMs: t.middlewareMs,
      unaccountedMs: t.unaccountedMs,
      totalMs: t.totalMs,
      tenantDbRoundTrips: t.tenantDbRoundTrips,
      orgLookupCount: t.orgLookupCount,
      bootstrap_server_cache_source: t.bootstrapCacheSource,
      bootstrap_server_cache_age_ms: t.bootstrapCacheAgeMs,
      bootstrap_build_ms: t.bootstrapBuildMs,
      bootstrap_total_ms: t.totalMs,
      ...extra,
    })
  );
}
