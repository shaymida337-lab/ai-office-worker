import {
  clarificationQuestionForIntent,
  calendarPendingAction,
  calendarPendingIntentFromExtraction,
  isCalendarFollowUpPhrase,
  isCalendarPendingIntentExpired,
  mergeCalendarPendingIntent,
  parseInitialCalendarPendingIntent,
  readCalendarPendingIntent,
  type CalendarPendingIntent,
} from "../calendar/calendarPendingIntent.js";
import {
  parseCalendarIntent,
  type CalendarIntentAction,
  type CalendarIntentExtraction,
} from "../calendar/calendarIntentParser.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";

export type CalendarConversationPhase = "idle" | "slot_filling" | "awaiting_confirmation";

const EXPLICIT_CALENDAR_INTENTS = new Set<CalendarIntentAction>([
  "create_appointment",
  "cancel_appointment",
  "move_appointment",
]);

export function readCalendarConversationPhase(
  session: Pick<ConversationSessionRecord, "pendingAction" | "pendingConfirmation">
): CalendarConversationPhase {
  if (session.pendingConfirmation) return "awaiting_confirmation";
  if (resolveActiveSlotFillingIntent(session)) return "slot_filling";
  return "idle";
}

export function resolveActiveSlotFillingIntent(
  session: Pick<ConversationSessionRecord, "pendingAction">
): CalendarPendingIntent | null {
  const pending = readCalendarPendingIntent(session.pendingAction);
  if (!pending || isCalendarPendingIntentExpired(pending)) return null;
  return pending;
}

export function isExplicitCalendarCommand(extraction: CalendarIntentExtraction): boolean {
  return EXPLICIT_CALENDAR_INTENTS.has(extraction.intent);
}

export function shouldFreshCommandReplaceSlotFilling(
  message: string,
  pending: CalendarPendingIntent | null
): boolean {
  if (!pending) return false;
  if (pending.customerCandidates?.length) return false;
  const incoming = parseCalendarIntent(message);
  return isExplicitCalendarCommand(incoming) && incoming.missingFields.length === 0;
}

export function shouldDeferCalendarClarificationToSession(
  extraction: CalendarIntentExtraction
): boolean {
  if (!isExplicitCalendarCommand(extraction)) return false;
  if (extraction.missingFields.length > 0) return true;
  if (extraction.intent === "create_appointment") {
    return (
      !extraction.customerName ||
      !extraction.dayReference ||
      !extraction.time ||
      extraction.confidence !== "high"
    );
  }
  return false;
}

export function extractInitialSlotFillingIntent(
  message: string,
  options: { timeZone?: string; now?: Date } = {}
): CalendarPendingIntent | null {
  return parseInitialCalendarPendingIntent(message, options);
}

export function clarificationForSlotFilling(intent: CalendarPendingIntent): string {
  const extraction: CalendarIntentExtraction = {
    intent: intent.intent,
    customerName: intent.customerName,
    dayReference: intent.dayReference,
    date: intent.date,
    time: intent.time,
    cancelTarget: intent.cancelTarget,
    missingFields: intent.missingFields,
    rawText: intent.originalUserText,
    confidence: "low",
    durationMinutes: null,
    serviceName: null,
    notes: null,
  };
  return clarificationQuestionForIntent(extraction);
}

export type SlotFillingMergeResult =
  | { kind: "fresh_command" }
  | { kind: "slot_filling"; intent: CalendarPendingIntent };

export function mergeSlotFillingTurn(
  pending: CalendarPendingIntent,
  message: string,
  options: { timeZone?: string; now?: Date } = {}
): SlotFillingMergeResult {
  if (shouldFreshCommandReplaceSlotFilling(message, pending)) {
    return { kind: "fresh_command" };
  }

  const incoming = parseCalendarIntent(message, options);
  if (
    isExplicitCalendarCommand(incoming) &&
    incoming.intent !== pending.intent &&
    incoming.missingFields.length === 0 &&
    !isCalendarFollowUpPhrase(message)
  ) {
    return { kind: "fresh_command" };
  }

  const merged = mergeCalendarPendingIntent(pending, message, options.timeZone, options.now);
  merged.missingFields = merged.missingFields.filter(Boolean);
  return { kind: "slot_filling", intent: merged };
}

export function slotFillingPendingAction(intent: CalendarPendingIntent) {
  return calendarPendingAction(intent);
}

export function slotFillingFromExtraction(
  extraction: CalendarIntentExtraction,
  params: { originalUserText: string; lastAssistantQuestion: string; now?: Date }
): CalendarPendingIntent | null {
  return calendarPendingIntentFromExtraction(extraction, params);
}
