import { prisma } from "../../lib/prisma.js";
import type { PlatformRole } from "./permissions.js";
import { isPlatformRole } from "./permissions.js";

export type ResolvedMembership = {
  userId: string;
  organizationId: string;
  role: PlatformRole;
  membershipId: string | null;
  isOrganizationOwner: boolean;
};

export type MembershipDb = Pick<typeof prisma, "organizationMember" | "organization">;

/**
 * Resolve effective role for a user in an organization.
 * Falls back to owner when user is Organization.userId (legacy 1:1 model).
 */
export async function resolveMembershipRole(
  userId: string,
  organizationId: string,
  db: MembershipDb = prisma,
): Promise<ResolvedMembership | null> {
  const [member, organization] = await Promise.all([
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, role: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { userId: true },
    }),
  ]);

  if (!organization) return null;

  const isOrganizationOwner = organization.userId === userId;

  if (member && isPlatformRole(member.role)) {
    return {
      userId,
      organizationId,
      role: member.role,
      membershipId: member.id,
      isOrganizationOwner,
    };
  }

  if (isOrganizationOwner) {
    return {
      userId,
      organizationId,
      role: "owner",
      membershipId: member?.id ?? null,
      isOrganizationOwner: true,
    };
  }

  return null;
}

export async function ensureOwnerMembership(
  organizationId: string,
  userId: string,
  db: MembershipDb = prisma,
): Promise<void> {
  await db.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, role: "owner" },
    update: { role: "owner" },
  });
}

export async function listOrganizationMembers(organizationId: string, db: MembershipDb = prisma) {
  return db.organizationMember.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}
