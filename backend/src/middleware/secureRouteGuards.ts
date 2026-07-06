import type { NextFunction, Request, Response } from "express";
import { isProduction, requireOpsAccess } from "../lib/productionGuard.js";
import { requirePerm } from "../services/rbac/index.js";

const DEBUG_PREFIXES = ["/debug/", "/automation/", "/help/auto-fix"];
const CRM_WRITE = [/^\/leads(?:\/|$)/, /^\/deals(?:\/|$)/, /^\/quotes(?:\/|$)/];
const GMAIL_SCAN = [/^\/gmail(?:\/|$)/, /^\/gmail-scan$/, /^\/sync\/gmail$/];
const WHATSAPP_TEST = /\/whatsapp\/test|\/integrations\/whatsapp\/test/;
const WHATSAPP_WRITE = [/^\/whatsapp-assistant\/settings$/, /^\/integrations\/whatsapp\/settings$/, /^\/settings\/whatsapp$/];

function matchesAny(path: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(path));
}

export function secureRouteGuards(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  const method = req.method.toUpperCase();

  if (isProduction() && DEBUG_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return requireOpsAccess(req, res, next);
  }

  if (method !== "GET" && matchesAny(path, CRM_WRITE)) {
    return requirePerm("work.view")(req, res, next);
  }

  if (method === "POST" && matchesAny(path, GMAIL_SCAN)) {
    return requirePerm("integrations.gmail.connect")(req, res, next);
  }

  if (WHATSAPP_TEST.test(path)) {
    return requirePerm("organization.settings")(req, res, next);
  }

  if (method !== "GET" && matchesAny(path, WHATSAPP_WRITE)) {
    return requirePerm("organization.settings")(req, res, next);
  }

  next();
}
