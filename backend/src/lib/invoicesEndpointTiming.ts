/**
 * Safe Server-Timing for invoices bootstrap + slim list.
 * No tokens, PII, bodies, or secrets.
 */
export type InvoicesEndpointTiming = {
  preRouteMs: number;
  authMs: number;
  tenantMs: number;
  tenantDbMs: number;
  orgMs: number;
  queryMs: number;
  countMs: number;
  relationsMs: number;
  mapMs: number;
  serializeMs: number;
  responseMs: number;
  unaccountedMs: number;
  totalMs: number;
  tenantDbRoundTrips: number;
};

export function accountedExclusiveMs(t: InvoicesEndpointTiming): number {
  return (
    t.preRouteMs +
    t.authMs +
    t.tenantMs +
    t.orgMs +
    t.queryMs +
    t.countMs +
    t.relationsMs +
    t.mapMs +
    t.serializeMs +
    t.responseMs
  );
}

export function computeInvoicesUnaccountedMs(
  t: Omit<InvoicesEndpointTiming, "unaccountedMs">
): number {
  return Math.max(0, Math.round(t.totalMs - accountedExclusiveMs({ ...t, unaccountedMs: 0 })));
}

export function buildInvoicesServerTiming(t: InvoicesEndpointTiming): string {
  return [
    `pre_route;dur=${t.preRouteMs}`,
    `auth;dur=${t.authMs}`,
    `tenant;dur=${t.tenantMs}`,
    `tenant_db;dur=${t.tenantDbMs}`,
    `org;dur=${t.orgMs}`,
    `query;dur=${t.queryMs}`,
    `count;dur=${t.countMs}`,
    `relations;dur=${t.relationsMs}`,
    `map;dur=${t.mapMs}`,
    `serialize;dur=${t.serializeMs}`,
    `response;dur=${t.responseMs}`,
    `unaccounted;dur=${t.unaccountedMs}`,
    `total;dur=${t.totalMs}`,
  ].join(", ");
}

export function isInvoicesBootstrapTimingPath(path: string): boolean {
  return path === "/invoices/bootstrap" || path.endsWith("/invoices/bootstrap");
}

export function isInvoicesListTimingPath(path: string): boolean {
  return path === "/invoices/list" || path.endsWith("/invoices/list");
}

export function isInvoicesFpTimingPath(path: string): boolean {
  return isInvoicesBootstrapTimingPath(path) || isInvoicesListTimingPath(path);
}

export function logInvoicesTimingSafe(
  label: string,
  t: InvoicesEndpointTiming,
  extra?: Record<string, string | number | boolean | null>
): void {
  if (process.env.INVOICES_FP_DEBUG !== "1" && process.env.INVOICES_TIMING !== "1") return;
  console.info(
    `[${label} timing]`,
    JSON.stringify({
      preRouteMs: t.preRouteMs,
      authMs: t.authMs,
      tenantMs: t.tenantMs,
      tenantDbMs: t.tenantDbMs,
      orgMs: t.orgMs,
      queryMs: t.queryMs,
      countMs: t.countMs,
      relationsMs: t.relationsMs,
      mapMs: t.mapMs,
      serializeMs: t.serializeMs,
      responseMs: t.responseMs,
      unaccountedMs: t.unaccountedMs,
      totalMs: t.totalMs,
      tenantDbRoundTrips: t.tenantDbRoundTrips,
      ...extra,
    })
  );
}
