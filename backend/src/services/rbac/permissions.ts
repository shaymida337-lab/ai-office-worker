/**
 * Phase 2.5 — explicit platform permission catalog (no wildcards).
 */

export const PLATFORM_ROLES = ["owner", "admin", "accountant", "employee", "read_only"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  "payment.create",
  "payment.update",
  "payment.delete",
  "payment.view",
  "invoice.update",
  "invoice.delete",
  "invoice.view",
  "review.approve",
  "review.reject",
  "review.view",
  "document.view",
  "document.upload",
  "integrations.gmail.connect",
  "integrations.gmail.disconnect",
  "integrations.drive.connect",
  "integrations.drive.disconnect",
  "users.invite",
  "users.permissions",
  "organization.settings",
  "organization.delete",
  "audit.view",
  "reliability.view",
  "dashboard.view",
  "report.view",
  "report.export",
  "chat.use",
  "work.view",
  "billing.manage",
  "calendar.view",
  "calendar.create",
  "calendar.update",
  "calendar.cancel",
  "calendar.reschedule",
  "calendar.approve_decision",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const FINANCIAL_PERMISSIONS = new Set<PlatformPermission>([
  "payment.create",
  "payment.update",
  "payment.delete",
  "invoice.update",
  "invoice.delete",
  "review.approve",
  "review.reject",
]);

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isPlatformPermission(value: string): value is PlatformPermission {
  return (PLATFORM_PERMISSIONS as readonly string[]).includes(value);
}

export function permissionLabel(permission: PlatformPermission): string {
  return permission;
}
