import type { RecoveryAllowedOperation } from "./hardeningTypes.js";
import {
  RECOVERY_ALLOWED_OPERATIONS,
  RECOVERY_FORBIDDEN_WITHOUT_APPROVAL,
} from "./hardeningTypes.js";

export type RecoveryOperationDefinition = {
  operation: RecoveryAllowedOperation | (typeof RECOVERY_FORBIDDEN_WITHOUT_APPROVAL)[number];
  allowed: boolean;
  requiresHumanApproval: boolean;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
};

export const RECOVERY_OPERATION_CATALOG: readonly RecoveryOperationDefinition[] = [
  op("retry_failed_scan", true, false, "Retry a failed Gmail scan job", "low"),
  op("requeue_stuck_job", true, false, "Requeue stuck processing job", "low"),
  op("refresh_expired_integration_token", true, false, "Refresh OAuth token for Gmail/Drive", "low"),
  op("rebuild_dashboard_cache", true, false, "Rebuild dashboard aggregate cache", "low"),
  op("retry_drive_save", true, false, "Retry failed Drive upload", "low"),
  op("retry_notification_send", true, false, "Retry failed notification delivery", "low"),
  op("change_amount", false, true, "Modify payment amount", "critical"),
  op("delete_payment", false, true, "Delete supplier payment", "critical"),
  op("approve_payment", false, true, "Approve payment without user", "critical"),
  op("create_payment_after_blocked", false, true, "Create payment after blocked decision", "critical"),
  op("change_supplier", false, true, "Change supplier on payment", "high"),
  op("change_permissions", false, true, "Modify user permissions", "critical"),
  op("modify_invoice", false, true, "Modify invoice record", "high"),
];

function op(
  operation: RecoveryOperationDefinition["operation"],
  allowed: boolean,
  requiresHumanApproval: boolean,
  description: string,
  riskLevel: RecoveryOperationDefinition["riskLevel"],
): RecoveryOperationDefinition {
  return { operation, allowed, requiresHumanApproval, description, riskLevel };
}

export function canExecuteRecoveryOperation(operation: string): {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reason: string;
} {
  const def = RECOVERY_OPERATION_CATALOG.find((o) => o.operation === operation);
  if (!def) return { allowed: false, requiresHumanApproval: true, reason: "unknown operation" };
  if (!def.allowed) {
    return {
      allowed: false,
      requiresHumanApproval: true,
      reason: `${operation} forbidden without human approval`,
    };
  }
  return {
    allowed: true,
    requiresHumanApproval: def.requiresHumanApproval,
    reason: def.description,
  };
}

export function listAllowedRecoveryOperations(): RecoveryAllowedOperation[] {
  return [...RECOVERY_ALLOWED_OPERATIONS];
}

export function listForbiddenRecoveryOperations(): string[] {
  return [...RECOVERY_FORBIDDEN_WITHOUT_APPROVAL];
}
