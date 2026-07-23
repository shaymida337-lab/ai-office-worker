import type { NextFunction, Request, Response } from "express";
import { resolveVerifiedTenant, toRequestVerifiedTenant } from "../services/tenant/verifiedTenant.js";
import { isAppointmentsTimingPath } from "../lib/appointmentsEndpointTiming.js";
import { isDashboardBootstrapTimingPath } from "../lib/dashboardBootstrapServerTiming.js";
import { isInvoicesFpTimingPath } from "../lib/invoicesEndpointTiming.js";
import {
  FINANCIAL_INGESTION_CONTAINMENT_CODE,
  FINANCIAL_READ_CONTAINMENT_CODE,
  isAllowedInvoiceListRead,
  isFinancialDataPath,
  isFinancialIngestionContainmentActive,
  isFinancialIngestionPath,
  isFinancialReadContainmentActive,
} from "../services/p0/financialContainment.js";

export {
  isAllowedInvoiceListRead,
  isFinancialDataContainmentActive,
  isFinancialDataPath,
  isFinancialIngestionContainmentActive,
  isFinancialReadContainmentActive,
} from "../services/p0/financialContainment.js";

export async function validateTenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const timingAppointments = isAppointmentsTimingPath(req.path);
  const timingBootstrap = isDashboardBootstrapTimingPath(req.path);
  const timingInvoices = isInvoicesFpTimingPath(req.path);
  const timing = timingAppointments || timingBootstrap || timingInvoices;
  const tenantT0 = timing ? performance.now() : 0;
  if (timingAppointments) {
    res.locals.appointmentsTenantStart = tenantT0;
  }
  if (timingBootstrap) {
    res.locals.dashboardBootstrapTenantStart = tenantT0;
  }
  if (timingInvoices) {
    res.locals.invoicesFpTenantStart = tenantT0;
  }

  const { tenant, reason, cacheSource, cacheAgeMs, dbMs } = await resolveVerifiedTenant(req.auth);

  if (timingAppointments) {
    const tenantEnd = performance.now();
    res.locals.appointmentsTenantEnd = tenantEnd;
    res.locals.appointmentsTenantMs = Math.round(tenantEnd - tenantT0);
    res.locals.appointmentsTenantCacheSource = cacheSource;
    res.locals.appointmentsTenantCacheAgeMs = cacheAgeMs;
    res.locals.appointmentsTenantDbMs = dbMs;
  }
  if (timingBootstrap) {
    const tenantEnd = performance.now();
    res.locals.dashboardBootstrapTenantEnd = tenantEnd;
    res.locals.dashboardBootstrapTenantMs = Math.round(tenantEnd - tenantT0);
    res.locals.dashboardBootstrapTenantCacheSource = cacheSource;
    res.locals.dashboardBootstrapTenantCacheAgeMs = cacheAgeMs;
    res.locals.dashboardBootstrapTenantDbMs = dbMs;
  }
  if (timingInvoices) {
    const tenantEnd = performance.now();
    res.locals.invoicesFpTenantEnd = tenantEnd;
    res.locals.invoicesFpTenantMs = Math.round(tenantEnd - tenantT0);
    res.locals.invoicesFpTenantCacheSource = cacheSource;
    res.locals.invoicesFpTenantCacheAgeMs = cacheAgeMs;
    res.locals.invoicesFpTenantDbMs = dbMs;
  }

  if (!tenant) {
    console.warn(
      `[tenant-isolation] denied userId=${req.auth.userId} tokenOrg=${req.auth.organizationId} reason=${reason ?? "unknown"} path=${req.path}`,
    );
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (tenant.organizationId !== req.auth.organizationId) {
    console.warn(
      `[tenant-isolation] corrected stale token org userId=${tenant.userId} tokenOrg=${req.auth.organizationId} resolvedOrg=${tenant.organizationId} path=${req.path}`,
    );
  }

  req.auth = {
    userId: tenant.userId,
    organizationId: tenant.organizationId,
    email: tenant.email,
  };
  req.verifiedTenant = toRequestVerifiedTenant(tenant);
  next();
}

function respondContainment503(
  res: Response,
  path: string,
  method: string,
  org: string | undefined,
  code: string,
) {
  console.warn(
    `[tenant-isolation] financial containment active code=${code} method=${method} path=${path} org=${org ?? "unknown"}`,
  );
  res.status(503).json({
    error: "Financial documents are temporarily unavailable while tenant isolation is verified.",
    code,
  });
}

export function financialDataContainmentMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const isIngestionPath = isFinancialIngestionPath(req.path);
  const isReadPath = isFinancialDataPath(req.path);

  if (!isIngestionPath && !isReadPath) {
    next();
    return;
  }

  if (isIngestionPath) {
    if (isFinancialIngestionContainmentActive()) {
      respondContainment503(
        res,
        req.path,
        req.method,
        req.auth?.organizationId,
        FINANCIAL_INGESTION_CONTAINMENT_CODE,
      );
      return;
    }
    next();
    return;
  }

  // Controlled reopen: invoice list + month tabs only (GET). All other financial reads stay gated.
  if (isAllowedInvoiceListRead(req.method, req.path)) {
    next();
    return;
  }

  if (isFinancialReadContainmentActive()) {
    respondContainment503(
      res,
      req.path,
      req.method,
      req.auth?.organizationId,
      FINANCIAL_READ_CONTAINMENT_CODE,
    );
    return;
  }

  next();
}
