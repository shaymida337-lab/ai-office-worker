import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { PlatformPermission } from "./permissions.js";
import { checkPermission as defaultCheckPermission, forbiddenResponseBody } from "./authorization.js";
import type { PermissionCheckResult } from "./authorization.js";
import { recordPermissionDeniedAudit } from "./rbacAudit.js";
import { emitPermissionDeniedReliability } from "./rbacReliability.js";
import { recordCalendarAudit } from "../calendar/calendarAudit.js";

export type RbacMiddlewareDeps = {
  checkPermission?: typeof defaultCheckPermission;
};

/**
 * Express middleware — enforces a single explicit permission.
 */
export function requirePermissionMiddleware(
  permission: PlatformPermission,
  deps: RbacMiddlewareDeps = {},
): RequestHandler {
  const checkPermission = deps.checkPermission ?? defaultCheckPermission;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const sourceRoute = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
    const result = await checkPermission({
      userId: req.auth.userId,
      organizationId: req.auth.organizationId,
      permission,
      sourceModule: "rbac",
      sourceRoute,
      verifiedTenant: req.verifiedTenant ?? null,
    });

    if (!result.allowed) {
      recordPermissionDeniedAudit({
        userId: req.auth.userId,
        organizationId: req.auth.organizationId,
        permission: String(result.permission),
        role: result.role,
        sourceModule: "rbac",
        sourceRoute,
        reason: result.reason,
      });
      emitPermissionDeniedReliability({
        organizationId: req.auth.organizationId,
        userId: req.auth.userId,
        permission: String(result.permission),
        role: result.role,
        reason: result.reason,
      });
      if (String(result.permission).startsWith("calendar.")) {
        recordCalendarAudit({
          organizationId: req.auth.organizationId,
          entityType: "permission",
          entityId: String(result.permission),
          action: "calendar_permission_denied",
          actor: { actorType: "user", actorUserId: req.auth.userId, actorRole: result.role },
          sourceModule: "rbac",
          sourceRoute,
          reason: result.reason,
          metadata: {
            permission: String(result.permission),
            role: result.role,
          },
        });
      }
      res.status(403).json(forbiddenResponseBody(result));
      return;
    }

    next();
  };
}

/** Shorter alias for route definitions. */
export function requirePerm(permission: PlatformPermission): RequestHandler {
  return requirePermissionMiddleware(permission);
}

/** Test helper — always-allow permission middleware. */
export function allowAllPermissionsMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

/** Test helper — build a checkPermission stub for a fixed role. */
export function checkPermissionStubForRole(
  role: PermissionCheckResult["role"],
): typeof defaultCheckPermission {
  return async (input) => ({
    allowed: role === "owner" || role === "admin",
    permission: input.permission,
    role,
    organizationId: input.organizationId,
    reason: "stub",
  });
}
