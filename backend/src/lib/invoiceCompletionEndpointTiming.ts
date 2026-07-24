/**
 * Safe Server-Timing for invoice-completion bootstrap + slim list.
 * No tokens, PII, bodies, or secrets.
 */
export type InvoiceCompletionEndpointTiming = {
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

export function accountedExclusiveMs(t: InvoiceCompletionEndpointTiming): number {
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

export function computeCompletionUnaccountedMs(
  t: Omit<InvoiceCompletionEndpointTiming, "unaccountedMs">
): number {
  return Math.max(0, Math.round(t.totalMs - accountedExclusiveMs({ ...t, unaccountedMs: 0 })));
}

export function buildCompletionServerTiming(t: InvoiceCompletionEndpointTiming): string {
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

export function isInvoiceCompletionBootstrapTimingPath(path: string): boolean {
  return path === "/invoice-completion/bootstrap" || path.endsWith("/invoice-completion/bootstrap");
}

export function isInvoiceCompletionListTimingPath(path: string): boolean {
  return path === "/invoice-completion/list" || path.endsWith("/invoice-completion/list");
}

export function isInvoiceCompletionFpTimingPath(path: string): boolean {
  return isInvoiceCompletionBootstrapTimingPath(path) || isInvoiceCompletionListTimingPath(path);
}

export function logCompletionTimingSafe(
  label: string,
  t: InvoiceCompletionEndpointTiming,
  extra?: Record<string, string | number | boolean | null>
): void {
  if (process.env.INVOICE_COMPLETION_FP_DEBUG !== "1" && process.env.INVOICE_COMPLETION_TIMING !== "1") {
    return;
  }
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
