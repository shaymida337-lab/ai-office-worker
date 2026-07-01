import type { RbacAction, RbacRole } from "./hardeningTypes.js";
import { RBAC_ACTIONS, RBAC_ROLES } from "./hardeningTypes.js";

export const RBAC_PERMISSION_MATRIX: Readonly<Record<RbacRole, readonly RbacAction[]>> = {
  owner: [...RBAC_ACTIONS],
  admin: without(RBAC_ACTIONS, "manage_billing"),
  manager: [
    "view_documents",
    "upload_documents",
    "approve_documents",
    "reject_documents",
    "create_payments",
    "edit_payments",
    "export_reports",
    "view_audit_log",
  ],
  accountant: [
    "view_documents",
    "upload_documents",
    "approve_documents",
    "reject_documents",
    "create_payments",
    "edit_payments",
    "export_reports",
    "view_audit_log",
  ],
  employee: ["view_documents", "upload_documents"],
  external_accountant: [
    "view_documents",
    "upload_documents",
    "approve_documents",
    "reject_documents",
    "export_reports",
    "view_audit_log",
  ],
  read_only: ["view_documents", "export_reports"],
};

export const FINANCIAL_RBAC_ACTIONS: readonly RbacAction[] = [
  "approve_documents",
  "reject_documents",
  "create_payments",
  "edit_payments",
  "delete_payments",
] as const;

export function roleHasPermission(role: RbacRole, action: RbacAction): boolean {
  return RBAC_PERMISSION_MATRIX[role].includes(action);
}

export function assertFinancialPermission(role: RbacRole, action: RbacAction): {
  allowed: boolean;
  reason: string;
} {
  if (!FINANCIAL_RBAC_ACTIONS.includes(action)) {
    return { allowed: roleHasPermission(role, action), reason: "non-financial action" };
  }
  const allowed = roleHasPermission(role, action);
  return {
    allowed,
    reason: allowed
      ? `${role} may perform ${action}`
      : `DENIED: ${role} cannot perform financial action ${action}`,
  };
}

export function listRoles(): RbacRole[] {
  return [...RBAC_ROLES];
}

export function listActions(): RbacAction[] {
  return [...RBAC_ACTIONS];
}

function without<T extends string>(all: readonly T[], ...exclude: T[]): T[] {
  const set = new Set(exclude);
  return all.filter((item) => !set.has(item));
}
