import { Router, type Request, type Response } from "express";
import { errorDetails } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import {
  getScannerHealthFailuresResponse,
  getScannerHealthResponse,
  parseScannerHealthLimit,
  parseScannerHealthRange,
  type ScannerHealthFailuresApiResponse,
  type ScannerHealthServiceDb,
} from "../services/scanner/scannerHealthService.js";

export type ScannerHealthRouteDeps = {
  db: ScannerHealthServiceDb;
  getHealth: typeof getScannerHealthResponse;
  getFailures: typeof getScannerHealthFailuresResponse;
};

const defaultDeps: ScannerHealthRouteDeps = {
  db: prisma,
  getHealth: getScannerHealthResponse,
  getFailures: getScannerHealthFailuresResponse,
};

function queryRecord(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export function createScannerHealthRouter(
  deps: ScannerHealthRouteDeps = defaultDeps,
): Router {
  const router = Router();

  router.get("/scanner/health", async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const now = new Date();
    const range = parseScannerHealthRange(queryRecord(req), now);
    try {
      const payload = await deps.getHealth(deps.db, {
        organizationId,
        range,
        now,
      });
      res.json(payload);
    } catch (err) {
      console.error("[scanner/health]", errorDetails(err));
      res.status(500).json({ error: "טעינת בריאות הסורק נכשלה" });
    }
  });

  router.get("/scanner/health/failures", async (req: Request, res: Response) => {
    const organizationId = req.auth!.organizationId;
    const now = new Date();
    const range = parseScannerHealthRange(queryRecord(req), now);
    const limit = parseScannerHealthLimit(queryRecord(req).limit);
    try {
      const payload: ScannerHealthFailuresApiResponse = await deps.getFailures(deps.db, {
        organizationId,
        range,
        limit,
        now,
      });
      res.json(payload);
    } catch (err) {
      console.error("[scanner/health/failures]", errorDetails(err));
      res.status(500).json({ error: "טעינת כשלי הסורק נכשלה" });
    }
  });

  return router;
}

export const scannerHealthRouter = createScannerHealthRouter();
