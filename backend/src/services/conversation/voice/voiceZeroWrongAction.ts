import type { ConversationSessionRecord, PendingConfirmation } from "../conversationTypes.js";
import { evaluateConfirmationPolicy } from "../conversationConfirmationPolicy.js";
import type { ZeroWrongActionResult } from "../conversationTypes.js";
import { evaluateZeroWrongAction } from "../conversationZeroWrongAction.js";

export function evaluateVoiceExecutionReadiness(input: {
  session: ConversationSessionRecord;
  pendingConfirmation: PendingConfirmation | null;
  role?: string | null;
  permissions?: string[];
}): ZeroWrongActionResult {
  const violations: string[] = [];

  if (!input.session?.id) {
    violations.push("session_inactive");
  }

  if (!input.pendingConfirmation) {
    violations.push("confirmation_missing");
  }

  if (input.pendingConfirmation) {
    const policy = evaluateConfirmationPolicy({
      action: input.pendingConfirmation.action,
      channel: "web_voice",
      role: input.role,
      permissions: input.permissions,
    });
    const proposalReady = evaluateZeroWrongAction({
      action: input.pendingConfirmation.action,
      proposal: input.pendingConfirmation.proposal,
      confirmation: policy,
      intentText: "voice_confirmation",
    });
    violations.push(...proposalReady.violations);
    if (!policy.allowed) {
      violations.push(policy.denialReason ?? "permission_denied");
    }
  }

  const ready = violations.length === 0;
  return {
    ready,
    violations,
    followUpQuestion: ready
      ? null
      : violations.includes("confirmation_missing")
        ? "אין לי פעולה שממתינה לאישור כרגע."
        : "לא הצלחתי לאשר את הפעולה בבטחה. אפשר לנסח שוב?",
  };
}
