import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { isProduction } from "./productionGuard.js";
import { secretsEqual } from "./secretsCrypto.js";

export function verifyLeadsWebhook(req: Request, res: Response, next: NextFunction) {
  const secret = config.webhooks.leadsSecret;
  if (!secret) {
    if (isProduction()) {
      res.status(503).json({ error: "Lead webhook is not configured" });
      return;
    }
    next();
    return;
  }

  const provided = req.header("x-leads-webhook-secret") ?? "";
  if (!provided || !secretsEqual(provided, secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as { organizationId?: string };
  if (!body.organizationId?.trim()) {
    res.status(400).json({ error: "organizationId is required" });
    return;
  }

  next();
}
