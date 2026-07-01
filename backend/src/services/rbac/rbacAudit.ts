import { recordPlatformAudit, userAuditContext } from "../auditLog/index.js";

export function recordPermissionDeniedAudit(input: {
  userId: string;
  organizationId: string;
  permission: string;
  role: string | null;
  sourceModule: string;
  sourceRoute: string | null;
  reason: string;
}): void {
  recordPlatformAudit({
    ...userAuditContext(input.userId, input.sourceModule, input.sourceRoute),
    organizationId: input.organizationId,
    entityType: "permission",
    entityId: input.permission,
    action: "permission_denied",
    reason: input.reason,
    metadata: {
      permission: input.permission,
      role: input.role,
    },
  });
}

export function recordRoleAssignmentAudit(input: {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
  previousRole: string | null;
  nextRole: string;
  sourceRoute: string;
}): void {
  recordPlatformAudit({
    ...userAuditContext(input.actorUserId, "rbac", input.sourceRoute),
    organizationId: input.organizationId,
    entityType: "organization_member",
    entityId: input.targetUserId,
    action: "permissions_changed",
    beforeState: input.previousRole ? { role: input.previousRole } : null,
    afterState: { role: input.nextRole },
    metadata: { targetUserId: input.targetUserId },
  });
}

export function recordUserInvitedAudit(input: {
  actorUserId: string;
  organizationId: string;
  invitedUserId: string;
  role: string;
  sourceRoute: string;
}): void {
  recordPlatformAudit({
    ...userAuditContext(input.actorUserId, "rbac", input.sourceRoute),
    organizationId: input.organizationId,
    entityType: "organization_member",
    entityId: input.invitedUserId,
    action: "user_invited",
    afterState: { role: input.role, userId: input.invitedUserId },
  });
}
