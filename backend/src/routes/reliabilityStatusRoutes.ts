import { Router, type Request, type Response } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { getHealthPayload } from "../lib/buildInfo.js";
import { GMAIL_SCAN_ACTIVE_STATUSES, GMAIL_SCAN_STUCK_TIMEOUT_MS } from "../services/gmailScanLifecycle.js";
import { requirePermissionMiddleware } from "../services/rbac/rbacMiddleware.js";

type ReliabilityStatusRouteDeps = {
  db: typeof prisma;
  requirePermission?: typeof requirePermissionMiddleware;
};

const defaultDeps: ReliabilityStatusRouteDeps = {
  db: prisma,
};

export function createReliabilityStatusRouter(
  deps: ReliabilityStatusRouteDeps = defaultDeps
): Router {
  const router = Router();
  const guard = deps.requirePermission ?? requirePermissionMiddleware;

  router.get(
    "/admin/reliability/status",
    guard("reliability.view"),
    async (req: Request, res: Response) => {
      const organizationId = req.auth!.organizationId;
      const now = new Date();
      const stuckCutoff = new Date(now.getTime() - GMAIL_SCAN_STUCK_TIMEOUT_MS);

      try {
        let database: "connected" | "disconnected" = "connected";
        try {
          await deps.db.$queryRaw`SELECT 1`;
        } catch {
          database = "disconnected";
        }

        const [jobRunCountsRaw, recentJobRuns, gmailRunningCount, gmailStuckCount] =
          await Promise.all([
            deps.db.jobRun.groupBy({
              by: ["status"],
              where: { organizationId },
              _count: { _all: true },
            }),
            deps.db.jobRun.findMany({
              where: {
                organizationId,
                status: { in: ["failed", "timeout"] },
              },
              orderBy: { updatedAt: "desc" },
              take: 20,
              select: {
                id: true,
                jobType: true,
                referenceId: true,
                status: true,
                startedAt: true,
                heartbeatAt: true,
                timeoutAt: true,
                completedAt: true,
                errorMessage: true,
                updatedAt: true,
              },
            }),
            deps.db.syncLog.count({
              where: {
                organizationId,
                type: "gmail_scan",
                status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
                finishedAt: null,
              },
            }),
            deps.db.syncLog.count({
              where: {
                organizationId,
                type: "gmail_scan",
                status: { in: [...GMAIL_SCAN_ACTIVE_STATUSES] },
                finishedAt: null,
                updatedAt: { lte: stuckCutoff },
              },
            }),
          ]);

        const counts = {
          running: 0,
          completed: 0,
          failed: 0,
          timeout: 0,
        };
        for (const row of jobRunCountsRaw) {
          if (row.status in counts) {
            counts[row.status as keyof typeof counts] = row._count._all;
          }
        }

        const health = getHealthPayload({
          status: database === "connected" ? "ok" : "error",
          database,
        });

        res.json({
          health: {
            status: health.status,
            database: health.database,
            commit: health.commit,
            serverStartedAt: health.serverStartedAt,
            instanceId: health.instanceId,
          },
          jobRuns: {
            counts,
            recentFailures: recentJobRuns,
          },
          gmailScans: {
            running: gmailRunningCount,
            stuck: gmailStuckCount,
            stuckThresholdMs: GMAIL_SCAN_STUCK_TIMEOUT_MS,
          },
          generatedAt: now.toISOString(),
        });
      } catch (err) {
        console.error("[admin/reliability/status]", errorDetails(err));
        res.status(500).json({ error: "Failed to load reliability status" });
      }
    }
  );

  return router;
}

export const reliabilityStatusRouter = createReliabilityStatusRouter();
