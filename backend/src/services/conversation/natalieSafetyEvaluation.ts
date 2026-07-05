import type { ConfirmationPolicyResult, ZeroWrongActionResult } from "./conversationTypes.js";
import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import { evaluateZeroWrongAction } from "./conversationZeroWrongAction.js";
import { isCalendarProposalExecutable } from "../scheduling/calendarAppointmentSafety.js";
import type { AppointmentResolutionMetadata } from "../scheduling/calendarAppointmentSafety.js";

export type NatalieSafetyEvaluation = {
  confidenceScore: number | null;
  actionRiskLevel: ConfirmationPolicyResult["riskLevel"];
  missingFields: string[];
  identityCertainty: "exact" | "fuzzy" | "context" | "unknown";
  confirmationRequired: boolean;
  executionReady: boolean;
  violations: string[];
  denialReason: string | null;
};

function readIdentityCertainty(proposal: Record<string, unknown> | null): NatalieSafetyEvaluation["identityCertainty"] {
  const metadata = proposal?.appointmentResolution as AppointmentResolutionMetadata | undefined;
  if (!metadata) return "unknown";
  if (metadata.source === "exact") return "exact";
  if (metadata.source === "conversation_context") return "context";
  if (metadata.source === "fuzzy") return "fuzzy";
  return "unknown";
}

export function evaluateNatalieSafety(input: {
  action: string | null;
  proposal: Record<string, unknown> | null;
  intentText: string;
  channel: "web_chat" | "web_voice" | "whatsapp" | "email" | "api";
  role?: string | null;
  permissions?: string[];
  transcriptConfidence?: number | null;
}): NatalieSafetyEvaluation {
  const confirmation = evaluateConfirmationPolicy({
    action: input.action,
    channel: input.channel,
    role: input.role,
    permissions: input.permissions,
  });
  const zeroWrong = evaluateZeroWrongAction({
    action: input.action,
    proposal: input.proposal,
    confirmation,
    intentText: input.intentText,
  });

  const calendarExecutable =
    !input.action ||
    !input.proposal ||
    !["cancel_appointment", "reschedule_appointment"].includes(input.action) ||
    isCalendarProposalExecutable(input.proposal);

  const executionReady = zeroWrong.ready && confirmation.allowed && calendarExecutable;

  return {
    confidenceScore: input.transcriptConfidence ?? null,
    actionRiskLevel: confirmation.riskLevel,
    missingFields: zeroWrong.violations.filter((v) => v.endsWith("_missing")),
    identityCertainty: readIdentityCertainty(input.proposal),
    confirmationRequired: confirmation.required,
    executionReady,
    violations: zeroWrong.violations,
    denialReason: confirmation.allowed ? null : confirmation.denialReason,
  };
}

export function hebrewSafetyFallback(violations: string[]): string {
  if (violations.includes("permission_denied") || violations.some((v) => v.startsWith("missing_permission"))) {
    return "אין לי הרשאה לבצע את הפעולה הזו.";
  }
  if (violations.includes("fuzzy_identity_confirmation_required")) {
    return "לפני שאמשיך, צריך לאשר למי התכוונת.";
  }
  if (violations.includes("intent_missing")) {
    return "לא הבנתי את הבקשה. אפשר לנסח שוב?";
  }
  if (violations.includes("proposal_missing")) {
    return "עוד לא הבנתי בדיוק מה לבצע. אפשר לפרט?";
  }
  if (violations.includes("confirmation_missing")) {
    return "אין לי פעולה שממתינה לאישור כרגע.";
  }
  return "לא הצלחתי לבצע את הפעולה בבטחה. אפשר לנסח שוב?";
}

export function summarizeZeroWrongAction(zeroWrong: ZeroWrongActionResult): NatalieSafetyEvaluation["executionReady"] {
  return zeroWrong.ready;
}
