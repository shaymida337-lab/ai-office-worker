import type { NextFunction, Request, Response } from "express";
import { resolveVerifiedTenant } from "../services/tenant/verifiedTenant.js";
import {
  FINANCIAL_INGESTION_CONTAINMENT_CODE,
  FINANCIAL_READ_CONTAINMENT_CODE,
  isFinancialDataPath,
  isFinancialIngestionContainmentActive,
  isFinancialIngestionPath,
  isFinancialReadContainmentActive,
} from "../services/p0/financialContainment.js";

export {
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

  const { tenant, reason } = await resolveVerifiedTenant(req.auth);
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
