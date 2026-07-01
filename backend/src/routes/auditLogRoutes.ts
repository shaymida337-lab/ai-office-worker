import { Router, type Request, type Response } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  listPlatformAuditLogs,
  listPlatformAuditLogsForEntity,
  parseAuditListFilters,
  type PlatformAuditReadDb,
} from "../services/auditLog/auditQueries.js";
import { requirePermissionMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { PlatformPermission } from "../services/rbac/permissions.js";

export type AuditLogRouteDeps = {
  db: PlatformAuditReadDb;
  requirePermission?: (permission: PlatformPermission) => ReturnType<typeof requirePermissionMiddleware>;
};

const defaultDeps: AuditLogRouteDeps = {
  db: prisma,
};

export function createAuditLogRouter(deps: AuditLogRouteDeps = defaultDeps): Router {
  const router = Router();
  const guard = (permission: PlatformPermission) =>
    deps.requirePermission?.(permission) ?? requirePermissionMiddleware(permission);

  router.get("/audit", guard("audit.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    try {
      const filters = parseAuditListFilters(organizationId, req.query as Record<string, unknown>);
      const result = await listPlatformAuditLogs(filters, deps.db);
      res.json({
        organizationId,
        ...result,
      });
    } catch (err) {
      console.error("[audit]", errorDetails(err));
      res.status(500).json({ error: "טעינת יומן ביקורת נכשלה" });
    }
  });

  router.get("/audit/:entityId", guard("audit.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : null;
    if (!entityType) {
      res.status(400).json({ error: "entityType query parameter is required" });
      return;
    }
    const entityId = String(req.params.entityId);
    try {
      const filters = parseAuditListFilters(organizationId, req.query as Record<string, unknown>);
      const result = await listPlatformAuditLogsForEntity(
        organizationId,
        entityType,
        entityId,
        filters,
        deps.db,
      );
      res.json({
        organizationId,
        entityType,
        entityId,
        ...result,
      });
    } catch (err) {
      console.error("[audit/entity]", errorDetails(err));
      res.status(500).json({ error: "טעינת יומן ביקורת לישות נכשלה" });
    }
  });

  return router;
}

export const auditLogRouter = createAuditLogRouter();
