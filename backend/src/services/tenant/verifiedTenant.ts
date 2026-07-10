import type { JwtPayload } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { resolveMembershipRole } from "../rbac/membership.js";
import type { PlatformRole } from "../rbac/permissions.js";

export type VerifiedTenant = {
  userId: string;
  organizationId: string;
  email: string;
  role: PlatformRole;
};

export type VerifiedTenantFailureReason =
  | "user_not_found"
  | "membership_denied"
  | "stale_organization_token";

/**
 * Resolve tenant exclusively from authenticated user + DB membership.
 * Never trust organizationId from request body/query/header.
 */
export async function resolveVerifiedTenant(auth: JwtPayload): Promise<{
  tenant: VerifiedTenant | null;
  reason?: VerifiedTenantFailureReason;
}> {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      email: true,
      organization: { select: { id: true } },
    },
  });
  if (!user) {
    return { tenant: null, reason: "user_not_found" };
  }

  const ownedOrganizationId = user.organization?.id ?? null;
  if (ownedOrganizationId && auth.organizationId !== ownedOrganizationId) {
    return { tenant: null, reason: "stale_organization_token" };
  }

  const membership = await resolveMembershipRole(auth.userId, auth.organizationId);
  if (!membership) {
    return { tenant: null, reason: "membership_denied" };
  }

  return {
    tenant: {
      userId: user.id,
      organizationId: membership.organizationId,
      email: user.email,
      role: membership.role,
    },
  };
}
