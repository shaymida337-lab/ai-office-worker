import type { NextFunction, Request, Response } from "express";
import { requirePerm } from "../services/rbac/index.js";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Ops / debug / destructive tooling — reliability.view in production. */
export const requireOpsAccess = requirePerm("reliability.view");

export function requireNonProduction(req: Request, res: Response, next: NextFunction) {
  if (isProduction()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

export function requireProductionOpsAccess(req: Request, res: Response, next: NextFunction) {
  if (!isProduction()) {
    next();
    return;
  }
  return requireOpsAccess(req, res, next);
}
