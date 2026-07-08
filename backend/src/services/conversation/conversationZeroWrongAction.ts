import type { ConfirmationPolicyResult, ZeroWrongActionResult } from "./conversationTypes.js";

export function evaluateZeroWrongAction(input: {
  action: string | null;
  proposal: Record<string, unknown> | null;
  confirmation: ConfirmationPolicyResult;
  intentText: string;
}): ZeroWrongActionResult {
  const violations: string[] = [];

  if (!input.intentText.trim()) {
    violations.push("intent_missing");
  }

  if (input.action && !input.confirmation.allowed) {
    violations.push(input.confirmation.denialReason ?? "permission_denied");
  }

  if (input.action && input.proposal) {
    violations.push(...validateProposal(input.action, input.proposal));
  } else if (input.action && input.action !== "show_invoice") {
    violations.push("proposal_missing");
  }

  if (input.confirmation.required && input.confirmation.confirmationType !== "none") {
    // Execution still happens on explicit user confirmation in later step.
  }

  const ready = violations.length === 0;
  return {
    ready,
    violations,
    followUpQuestion: ready ? null : buildFollowUpQuestion(violations),
  };
}

function validateProposal(action: string, proposal: Record<string, unknown>): string[] {
  switch (action) {
    case "create_task":
      return typeof proposal.title === "string" && proposal.title.trim() ? [] : ["task_title_missing"];
    case "complete_task":
      return typeof proposal.taskId === "string" && proposal.taskId.trim() ? [] : ["task_id_missing"];
    case "issue_invoice":
      return typeof proposal.customerName === "string" &&
        proposal.customerName.trim() &&
        typeof proposal.amount === "number"
        ? []
        : ["invoice_fields_missing"];
    case "book_appointment":
      return typeof proposal.clientName === "string" && proposal.clientName.trim()
        ? []
        : ["appointment_client_missing"];
    case "cancel_appointment":
    case "reschedule_appointment":
      return typeof proposal.appointmentId === "string" && proposal.appointmentId.trim()
        ? []
        : ["appointment_id_missing"];
    case "cancel_appointments":
      return Array.isArray(proposal.appointmentIds) && proposal.appointmentIds.length > 0
        ? []
        : ["appointment_id_missing"];
    case "suggest_available_times":
      return Array.isArray(proposal.slots) ? [] : ["availability_slots_missing"];
    case "last_listed_appointments":
      return Array.isArray(proposal.items) ? [] : ["listed_appointments_missing"];
    default:
      return [];
  }
}

function buildFollowUpQuestion(violations: string[]): string {
  if (violations.includes("permission_denied") || violations.some((v) => v.startsWith("missing_permission"))) {
    return "אין לי הרשאה לבצע את הפעולה הזו. רוצה שאסביר מה אפשר לעשות במקום?";
  }
  if (violations.includes("task_title_missing")) {
    return "על איזו משימה לדבר? תן לי כותרת ברורה.";
  }
  if (violations.includes("appointment_client_missing")) {
    return "למי לקבוע את התור?";
  }
  if (violations.includes("proposal_missing")) {
    return "עוד לא הבנתי בדיוק מה לבצע. אפשר לפרט?";
  }
  return "עוד חסר לי מידע כדי לבצע את זה בבטחה. אפשר לפרט?";
}
