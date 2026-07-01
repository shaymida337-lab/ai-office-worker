import { Router, type Request, type Response, type RequestHandler } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import type { IntegrityReadOnlyDb } from "../services/dataIntegrityWatch/integrityDb.js";
import { runIntegrityWatchForOrganization } from "../services/dataIntegrityWatch/integrityRunner.js";
import { buildIntegrityHealthExtension } from "../services/dataIntegrityWatch/integrityReliability.js";
import { formatIntegrityWatchReport } from "../services/dataIntegrityWatch/integrityReport.js";
import { integrityResultForTrustCertificate } from "../services/dataIntegrityWatch/integrityTrust.js";
import { requirePerm, requirePermissionMiddleware } from "../services/rbac/index.js";
import type { PlatformPermission } from "../services/rbac/permissions.js";

export type IntegrityWatchRouteDeps = {
  db: IntegrityReadOnlyDb;
  runForOrg: typeof runIntegrityWatchForOrganization;
  requirePermission?: (permission: PlatformPermission) => RequestHandler;
};

const defaultDeps: IntegrityWatchRouteDeps = {
  db: prisma,
  runForOrg: runIntegrityWatchForOrganization,
};

function queryDryRun(req: Request): boolean {
  return String(req.query.dryRun ?? "false").toLowerCase() === "true";
}

export function createIntegrityWatchRouter(
  deps: IntegrityWatchRouteDeps = defaultDeps,
): Router {
  const router = Router();
  const guard = (permission: PlatformPermission) =>
    deps.requirePermission?.(permission) ?? requirePermissionMiddleware(permission);

  router.get("/integrity/watch", guard("reliability.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const dryRun = queryDryRun(req);
    try {
      const report = await deps.runForOrg(deps.db, organizationId, {
        mode: dryRun ? "dry_run" : "manual",
        dryRun,
        organizationId,
      });
      res.json({
        report,
        health: buildIntegrityHealthExtension(report),
        trustStatus: integrityResultForTrustCertificate(report),
        summary: formatIntegrityWatchReport(report),
      });
    } catch (err) {
      console.error("[integrity/watch]", errorDetails(err));
      res.status(500).json({ error: "טעינת בדיקת שלמות נתונים נכשלה" });
    }
  });

  return router;
}

export const integrityWatchRouter = createIntegrityWatchRouter();
