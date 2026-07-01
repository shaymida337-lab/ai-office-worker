import type { PlatformPermission, PlatformRole } from "./permissions.js";
import { isPlatformPermission } from "./permissions.js";
import { permissionsForRole, roleGrantsPermission } from "./roleMatrix.js";
import { resolveMembershipRole } from "./membership.js";
import { recordPermissionDeniedAudit } from "./rbacAudit.js";
import { emitPermissionDeniedReliability } from "./rbacReliability.js";

export type PermissionCheckInput = {
  userId: string;
  organizationId: string;
  permission: PlatformPermission | string;
  sourceModule?: string;
  sourceRoute?: string | null;
};

export type PermissionCheckResult = {
  allowed: boolean;
  permission: PlatformPermission | string;
  role: PlatformRole | null;
  organizationId: string;
  reason: string;
};

export class PermissionDeniedError extends Error {
  readonly statusCode = 403;
  readonly result: PermissionCheckResult;

  constructor(result: PermissionCheckResult) {
    super(result.reason);
    this.name = "PermissionDeniedError";
    this.result = result;
  }
}

export function getEffectivePermissions(role: PlatformRole): PlatformPermission[] {
  return [...permissionsForRole(role)];
}

export async function checkPermission(input: PermissionCheckInput): Promise<PermissionCheckResult> {
  const permission = input.permission;
  if (!isPlatformPermission(permission)) {
    return {
      allowed: false,
      permission,
      role: null,
      organizationId: input.organizationId,
      reason: `Unknown permission: ${permission}`,
    };
  }

  const membership = await resolveMembershipRole(input.userId, input.organizationId);
  if (!membership) {
    return {
      allowed: false,
      permission,
      role: null,
      organizationId: input.organizationId,
      reason: "User is not a member of this organization",
    };
  }

  const allowed = roleGrantsPermission(membership.role, permission);
  return {
    allowed,
    permission,
    role: membership.role,
    organizationId: input.organizationId,
    reason: allowed
      ? `${membership.role} is allowed ${permission}`
      : `Role ${membership.role} does not have permission ${permission}`,
  };
}

export async function requirePermission(input: PermissionCheckInput): Promise<PermissionCheckResult> {
  const result = await checkPermission(input);
  if (!result.allowed) {
    recordPermissionDeniedAudit({
      userId: input.userId,
      organizationId: input.organizationId,
      permission: String(result.permission),
      role: result.role,
      sourceModule: input.sourceModule ?? "rbac",
      sourceRoute: input.sourceRoute ?? null,
      reason: result.reason,
    });
    emitPermissionDeniedReliability({
      organizationId: input.organizationId,
      userId: input.userId,
      permission: String(result.permission),
      role: result.role,
      reason: result.reason,
    });
    throw new PermissionDeniedError(result);
  }
  return result;
}

export function forbiddenResponseBody(result: PermissionCheckResult) {
  return {
    error: "Forbidden",
    permission: result.permission,
    role: result.role,
    organizationId: result.organizationId,
    action: result.permission,
    reason: result.reason,
  };
}
