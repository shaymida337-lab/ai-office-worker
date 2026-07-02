import type { PlatformPermission, PlatformRole } from "./permissions.js";
import { PLATFORM_PERMISSIONS } from "./permissions.js";

const ALL: readonly PlatformPermission[] = PLATFORM_PERMISSIONS;

const VIEW_AND_REPORT: readonly PlatformPermission[] = [
  "payment.view",
  "invoice.view",
  "review.view",
  "document.view",
  "dashboard.view",
  "report.view",
  "calendar.view",
];

/**
 * Explicit role → permission matrix. Deny by default; no wildcards.
 */
export const ROLE_PERMISSION_MATRIX: Readonly<Record<PlatformRole, readonly PlatformPermission[]>> = {
  owner: ALL,

  admin: without(ALL, "organization.delete"),

  accountant: [
    ...VIEW_AND_REPORT,
    "report.export",
    "review.approve",
    "review.reject",
    "payment.update",
    "invoice.update",
    "audit.view",
    "work.view",
    "calendar.create",
    "calendar.update",
    "calendar.cancel",
    "calendar.reschedule",
    "calendar.approve_decision",
  ],

  employee: [
    "document.view",
    "document.upload",
    "dashboard.view",
    "chat.use",
    "work.view",
    "payment.view",
    "invoice.view",
    "review.view",
    "calendar.view",
    "calendar.create",
    "calendar.update",
    "calendar.cancel",
    "calendar.reschedule",
  ],

  read_only: [...VIEW_AND_REPORT],
};

export function permissionsForRole(role: PlatformRole): readonly PlatformPermission[] {
  return ROLE_PERMISSION_MATRIX[role];
}

export function roleGrantsPermission(role: PlatformRole, permission: PlatformPermission): boolean {
  if (role === "owner") return true;
  return ROLE_PERMISSION_MATRIX[role].includes(permission);
}

/** Roles that may be assigned by non-owners. */
export function assignableRolesForActor(actorRole: PlatformRole): PlatformRole[] {
  if (actorRole === "owner") {
    return ["owner", "admin", "accountant", "employee", "read_only"];
  }
  if (actorRole === "admin") {
    return ["admin", "accountant", "employee", "read_only"];
  }
  return [];
}

export function canAssignRole(actorRole: PlatformRole, targetRole: PlatformRole): boolean {
  return assignableRolesForActor(actorRole).includes(targetRole);
}

function without<T extends string>(all: readonly T[], ...exclude: T[]): T[] {
  const set = new Set(exclude);
  return all.filter((item) => !set.has(item));
}
