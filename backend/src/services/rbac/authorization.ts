import type { PlatformPermission, PlatformRole } from "./permissions.js";
import { isPlatformPermission, isPlatformRole } from "./permissions.js";
import { permissionsForRole, roleGrantsPermission } from "./roleMatrix.js";
import { resolveMembershipRole } from "./membership.js";
import type { RequestVerifiedTenant } from "../tenant/verifiedTenant.js";
import { recordPermissionDeniedAudit } from "./rbacAudit.js";
import { emitPermissionDeniedReliability } from "./rbacReliability.js";

export type PermissionCheckInput = {
  userId: string;
  organizationId: string;
  permission: PlatformPermission | string;
  sourceModule?: string;
  sourceRoute?: string | null;
  /**
   * Request-scoped tenant verified by validateTenantMiddleware (DB).
   * Never accept values from client headers/query/body.
   */
  verifiedTenant?: RequestVerifiedTenant | null;
};

export type PermissionCheckResult = {
  allowed: boolean;
  permission: PlatformPermission | string;
  role: PlatformRole | null;
  organizationId: string;
  reason: string;
  /** How the role was obtained — for tests / Server-Timing. */
  roleSource?: "verified_tenant" | "membership" | "none";
};

export type CheckPermissionDeps = {
  resolveMembershipRole?: typeof resolveMembershipRole;
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

/**
 * Reuse request-scoped verified role only when userId + organizationId match exactly.
 * Mismatch / missing marker → null (caller must fall back to membership).
 */
export function tryReuseVerifiedTenantRole(input: PermissionCheckInput): PlatformRole | null {
  const vt = input.verifiedTenant;
  if (!vt || vt.verified !== true) return null;
  if (vt.userId !== input.userId) return null;
  if (vt.organizationId !== input.organizationId) return null;
  if (!isPlatformRole(vt.role)) return null;
  return vt.role;
}

export async function checkPermission(
  input: PermissionCheckInput,
  deps: CheckPermissionDeps = {}
): Promise<PermissionCheckResult> {
  const permission = input.permission;
  if (!isPlatformPermission(permission)) {
    return {
      allowed: false,
      permission,
      role: null,
      organizationId: input.organizationId,
      reason: `Unknown permission: ${permission}`,
      roleSource: "none",
    };
  }

  const reusedRole = tryReuseVerifiedTenantRole(input);
  if (reusedRole) {
    const allowed = roleGrantsPermission(reusedRole, permission);
    return {
      allowed,
      permission,
      role: reusedRole,
      organizationId: input.organizationId,
      reason: allowed
        ? `${reusedRole} is allowed ${permission}`
        : `Role ${reusedRole} does not have permission ${permission}`,
      roleSource: "verified_tenant",
    };
  }

  const resolveMembership = deps.resolveMembershipRole ?? resolveMembershipRole;
  const membership = await resolveMembership(input.userId, input.organizationId);
  if (!membership) {
    return {
      allowed: false,
      permission,
      role: null,
      organizationId: input.organizationId,
      reason: "User is not a member of this organization",
      roleSource: "membership",
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
    roleSource: "membership",
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
