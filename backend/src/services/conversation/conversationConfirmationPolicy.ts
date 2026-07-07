import type { PlatformPermission } from "../rbac/permissions.js";
import { isPlatformPermission } from "../rbac/permissions.js";
import { roleGrantsPermission } from "../rbac/roleMatrix.js";
import type { PlatformRole } from "../rbac/permissions.js";
import type {
  ConfirmationPolicyResult,
  ConfirmationType,
  NatalieChannel,
} from "./conversationTypes.js";

type ActionRisk = ConfirmationPolicyResult["riskLevel"];

const ACTION_PERMISSION: Record<string, PlatformPermission> = {
  issue_invoice: "payment.create",
  book_appointment: "calendar.create",
  cancel_appointment: "calendar.cancel",
  cancel_appointments: "calendar.cancel",
  reschedule_appointment: "calendar.reschedule",
  create_task: "chat.use",
  complete_task: "chat.use",
};

const ACTION_RISK: Record<string, ActionRisk> = {
  create_task: "reversible",
  complete_task: "reversible",
  show_invoice: "read_only",
  issue_invoice: "financial",
  book_appointment: "reversible",
  cancel_appointment: "destructive",
  cancel_appointments: "destructive",
  reschedule_appointment: "destructive",
  suggest_available_times: "read_only",
};

function confirmationTypeForRisk(risk: ActionRisk): ConfirmationType {
  if (risk === "read_only") return "none";
  if (risk === "reversible") return "soft";
  return "hard";
}

function defaultPrompts(action: string | null, confirmationType: ConfirmationType): { spokenPrompt: string; uiPrompt: string } {
  if (!action || confirmationType === "none") {
    return { spokenPrompt: "", uiPrompt: "" };
  }
  if (confirmationType === "soft") {
    return {
      spokenPrompt: "לאשר את הפעולה?",
      uiPrompt: "לאשר?",
    };
  }
  return {
    spokenPrompt: "זו פעולה רגישה. לאשר במפורש?",
    uiPrompt: "פעולה רגישה — לאשר?",
  };
}

export function evaluateConfirmationPolicy(input: {
  action: string | null;
  channel: NatalieChannel;
  role?: PlatformRole | string | null;
  permissions?: string[];
}): ConfirmationPolicyResult {
  if (!input.action) {
    return {
      required: false,
      confirmationType: "none",
      riskLevel: "read_only",
      spokenPrompt: "",
      uiPrompt: "",
      allowed: true,
    };
  }

  const riskLevel = ACTION_RISK[input.action] ?? "reversible";
  const confirmationType = confirmationTypeForRisk(riskLevel);
  const prompts = defaultPrompts(input.action, confirmationType);
  const requiredPermission = ACTION_PERMISSION[input.action] ?? "chat.use";
  const allowed = hasPermission(input.role, input.permissions, requiredPermission);

  return {
    required: confirmationType !== "none",
    confirmationType,
    riskLevel,
    spokenPrompt: prompts.spokenPrompt,
    uiPrompt: prompts.uiPrompt,
    allowed,
    denialReason: allowed ? null : `missing_permission:${requiredPermission}`,
  };
}

function hasPermission(
  role: PlatformRole | string | null | undefined,
  permissions: string[] | undefined,
  permission: PlatformPermission
): boolean {
  if (permissions?.length) {
    return permissions.includes(permission);
  }
  if (!role) return false;
  return roleGrantsPermission(role as PlatformRole, permission);
}

export function permissionsFromRole(role: PlatformRole | string | null | undefined): PlatformPermission[] {
  if (!role) return [];
  const values: PlatformPermission[] = [];
  for (const candidate of [
    "chat.use",
    "payment.create",
    "calendar.create",
    "calendar.cancel",
    "calendar.reschedule",
  ] as const) {
    if (isPlatformPermission(candidate) && roleGrantsPermission(role as PlatformRole, candidate)) {
      values.push(candidate);
    }
  }
  return values;
}
