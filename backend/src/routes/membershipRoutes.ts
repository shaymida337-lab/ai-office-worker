import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { errorDetails } from "../lib/errors.js";
import {
  assignableRolesForActor,
  canAssignRole,
  ensureOwnerMembership,
  getEffectivePermissions,
  isPlatformRole,
  listOrganizationMembers,
  recordRoleAssignmentAudit,
  recordUserInvitedAudit,
  requirePerm,
  resolveMembershipRole,
} from "../services/rbac/index.js";

export const membershipRouter = Router();

membershipRouter.get("/members/me", async (req: Request, res: Response) => {
  const membership = await resolveMembershipRole(req.auth!.userId, req.auth!.organizationId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden", reason: "Not a member of this organization" });
    return;
  }
  res.json({
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    permissions: getEffectivePermissions(membership.role),
    isOrganizationOwner: membership.isOrganizationOwner,
  });
});

membershipRouter.get("/members", requirePerm("users.permissions"), async (req: Request, res: Response) => {
  const members = await listOrganizationMembers(req.auth!.organizationId);
  res.json({
    members: members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      email: member.user.email,
      name: member.user.name,
      createdAt: member.createdAt.toISOString(),
    })),
  });
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.string(),
});

membershipRouter.post("/members/invite", requirePerm("users.invite"), async (req: Request, res: Response) => {
  try {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    const actor = await resolveMembershipRole(req.auth!.userId, req.auth!.organizationId);
    if (!actor) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const role = parsed.data.role;
    if (!isPlatformRole(role) || !canAssignRole(actor.role, role)) {
      res.status(400).json({ error: `Role ${role} cannot be assigned by ${actor.role}` });
      return;
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      res.status(404).json({ error: "User not found — they must register first" });
      return;
    }

    const member = await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: req.auth!.organizationId,
          userId: user.id,
        },
      },
      create: {
        organizationId: req.auth!.organizationId,
        userId: user.id,
        role,
      },
      update: { role },
    });

    recordUserInvitedAudit({
      actorUserId: req.auth!.userId,
      organizationId: req.auth!.organizationId,
      invitedUserId: user.id,
      role,
      sourceRoute: "POST /members/invite",
    });

    res.json({
      ok: true,
      member: {
        id: member.id,
        userId: member.userId,
        role: member.role,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("[members/invite]", errorDetails(err));
    res.status(500).json({ error: "Invite failed" });
  }
});

const roleUpdateSchema = z.object({
  role: z.string(),
});

membershipRouter.patch("/members/:userId/role", requirePerm("users.permissions"), async (req: Request, res: Response) => {
  try {
    const parsed = roleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }

    const actor = await resolveMembershipRole(req.auth!.userId, req.auth!.organizationId);
    if (!actor) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const nextRole = parsed.data.role;
    if (!isPlatformRole(nextRole) || !canAssignRole(actor.role, nextRole)) {
      res.status(400).json({ error: `Role ${nextRole} cannot be assigned by ${actor.role}` });
      return;
    }

    const targetUserId = String(req.params.userId);
    const organization = await prisma.organization.findUnique({
      where: { id: req.auth!.organizationId },
      select: { userId: true },
    });
    if (organization?.userId === targetUserId && nextRole !== "owner") {
      res.status(400).json({ error: "Cannot change role of organization owner" });
      return;
    }

    const existing = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: req.auth!.organizationId,
          userId: targetUserId,
        },
      },
    });

    const updated = await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: req.auth!.organizationId,
          userId: targetUserId,
        },
      },
      create: {
        organizationId: req.auth!.organizationId,
        userId: targetUserId,
        role: nextRole,
      },
      update: { role: nextRole },
    });

    recordRoleAssignmentAudit({
      actorUserId: req.auth!.userId,
      organizationId: req.auth!.organizationId,
      targetUserId,
      previousRole: existing?.role ?? null,
      nextRole,
      sourceRoute: "PATCH /members/:userId/role",
    });

    res.json({ ok: true, member: { id: updated.id, userId: updated.userId, role: updated.role } });
  } catch (err) {
    console.error("[members/role]", errorDetails(err));
    res.status(500).json({ error: "Role update failed" });
  }
});

membershipRouter.get("/roles", async (req: Request, res: Response) => {
  const membership = await resolveMembershipRole(req.auth!.userId, req.auth!.organizationId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json({
    assignableRoles: assignableRolesForActor(membership.role),
    currentRole: membership.role,
  });
});
