import { Router, type Request, type Response, type RequestHandler } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  generateAndRecordReleaseCertificate,
  getLatestReleaseCertificate,
  getReleaseCertificateById,
  listReleaseCertificateHistory,
  compareReleaseCertificates,
} from "../services/releaseCertificate/index.js";
import { requirePermissionMiddleware } from "../services/rbac/rbacMiddleware.js";
import type { PlatformPermission } from "../services/rbac/permissions.js";

export type ReleaseCertificateRouteDeps = {
  generate: typeof generateAndRecordReleaseCertificate;
  getLatest: typeof getLatestReleaseCertificate;
  getById: typeof getReleaseCertificateById;
  listHistory: typeof listReleaseCertificateHistory;
  requirePermission?: (permission: PlatformPermission) => RequestHandler;
};

const defaultDeps: ReleaseCertificateRouteDeps = {
  generate: generateAndRecordReleaseCertificate,
  getLatest: getLatestReleaseCertificate,
  getById: getReleaseCertificateById,
  listHistory: listReleaseCertificateHistory,
};

export function createReleaseCertificateRouter(
  deps: ReleaseCertificateRouteDeps = defaultDeps,
): Router {
  const router = Router();
  const guard = (permission: PlatformPermission) =>
    deps.requirePermission?.(permission) ?? requirePermissionMiddleware(permission);

  router.get("/release-certificate/latest", guard("reliability.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    try {
      const previous = await deps.getLatest(organizationId, prisma);
      const certificate = await deps.generate(
        {
          organizationId,
          environment: typeof req.query.environment === "string" ? req.query.environment : undefined,
          commitHash: typeof req.query.commitHash === "string" ? req.query.commitHash : undefined,
          deployId: typeof req.query.deployId === "string" ? req.query.deployId : undefined,
        },
        { sourceRoute: "GET /release-certificate/latest", actorId: req.auth!.userId },
      );

      const comparison = previous ? compareReleaseCertificates(previous, certificate) : null;

      res.json({ certificate, comparison });
    } catch (err) {
      console.error("[release-certificate]", errorDetails(err));
      res.status(500).json({ error: "Release certificate generation failed" });
    }
  });

  router.get("/release-certificate/history", guard("reliability.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    try {
      const history = await deps.listHistory(organizationId, { limit, cursor }, prisma);
      res.json({ organizationId, ...history });
    } catch (err) {
      console.error("[release-certificate]", errorDetails(err));
      res.status(500).json({ error: "Release certificate history failed" });
    }
  });

  router.get("/release-certificate/:certificateId", guard("reliability.view"), async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const certificateId = String(req.params.certificateId);
    try {
      const certificate = await deps.getById(organizationId, certificateId, prisma);
      if (!certificate) {
        res.status(404).json({ error: "Certificate not found" });
        return;
      }
      res.json({ organizationId, certificate });
    } catch (err) {
      console.error("[release-certificate]", errorDetails(err));
      res.status(500).json({ error: "Release certificate lookup failed" });
    }
  });

  return router;
}

export const releaseCertificateRouter = createReleaseCertificateRouter();
