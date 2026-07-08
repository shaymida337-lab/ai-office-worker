import { randomUUID } from "crypto";
import type { NatalieClaudeResponse } from "../claude.js";
import {
  clarificationQuestionForIntent,
  calendarPendingAction,
  calendarPendingIntentFromExtraction,
  isCalendarFollowUpPhrase,
  isCalendarPendingIntentExpired,
  mergeCalendarPendingIntent,
  parseInitialCalendarPendingIntent,
  readCalendarPendingIntent,
  recomputeMissingFields,
  type CalendarPendingIntent,
} from "../calendar/calendarPendingIntent.js";
import { parseCalendarIntent } from "../calendar/calendarIntentParser.js";
import { extractRescheduleAppointment, fulfillCalendarPendingIntent } from "../natalie.js";
import { getChannelAdapter } from "./conversationAdapters.js";
import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import {
  appendTurn,
  createConversationTurn,
  extractActionFromBrainResponse,
} from "./conversationHistory.js";
import type {
  ConversationSessionRecord,
  NatalieChannel,
  ProcessNatalieTurnResult,
} from "./conversationTypes.js";
import { evaluateZeroWrongAction } from "./conversationZeroWrongAction.js";
import { saveConversationSession } from "./conversationSession.js";
import {
  buildCalendarPendingConfirmation,
  extractCalendarBrainResponse,
} from "./calendarConfirmationContinuation.js";
import { extractActiveCalendarContext } from "../scheduling/calendarAppointmentResolver.js";
import { parseVoiceConfirmationIntent } from "./voice/voiceConfirmation.js";
import { calendarMessages } from "../calendar/calendarMessages.js";
import { parseListedAppointmentOrdinalCommand } from "./lastListedAppointments.js";

function buildTurnResult(params: {
  session: ConversationSessionRecord;
  channel: NatalieChannel;
  answer: string;
  brainResponse?: NatalieClaudeResponse;
  pendingAction?: ConversationSessionRecord["pendingAction"];
  pendingConfirmation?: ConversationSessionRecord["pendingConfirmation"];
  role?: string | null;
  permissions?: string[];
}): ProcessNatalieTurnResult {
  const extracted = params.brainResponse
    ? extractCalendarBrainResponse(params.brainResponse as Record<string, unknown>)
    : extractActionFromBrainResponse(params.brainResponse ?? { answer: params.answer });
  const confirmation = evaluateConfirmationPolicy({
    action: extracted.action,
    channel: params.channel,
    role: params.role,
    permissions: params.permissions,
  });
  const zeroWrongAction = evaluateZeroWrongAction({
    action: extracted.action,
    proposal: extracted.proposal,
    confirmation,
    intentText: params.answer,
  });
  const adapter = getChannelAdapter(params.channel);
  const displayResponse = adapter.renderDisplay(
    params.brainResponse ?? { answer: params.answer },
    confirmation
  );
  const spokenResponse = adapter.renderSpoken(
    params.brainResponse ?? { answer: params.answer },
    confirmation
  );

  return {
    ...(params.brainResponse ?? { answer: params.answer }),
    conversationSessionId: params.session.id,
    displayResponse,
    spokenResponse,
    confirmation,
    zeroWrongAction,
    reliability: {
      correlationId: randomUUID(),
      sessionId: params.session.id,
      turnId: randomUUID(),
      health: zeroWrongAction.ready === false ? "Degraded" : "Healthy",
    },
  };
}

async function persistCalendarContinuationTurn(input: {
  session: ConversationSessionRecord;
  channel: NatalieChannel;
  message: string;
  answer: string;
  brainResponse?: NatalieClaudeResponse;
  pendingAction: ConversationSessionRecord["pendingAction"];
  pendingConfirmation: ConversationSessionRecord["pendingConfirmation"];
  role?: string | null;
  permissions?: string[];
  saveSession?: typeof saveConversationSession;
}) {
  const save = input.saveSession ?? saveConversationSession;
  const userTurn = createConversationTurn({
    role: "user",
    text: input.message,
    channel: input.channel,
  });
  const historyWithUser = appendTurn(input.session.structuredHistory, userTurn);
  const extracted = input.brainResponse
    ? extractCalendarBrainResponse(input.brainResponse as Record<string, unknown>)
    : extractActionFromBrainResponse(input.brainResponse ?? { answer: input.answer });
  const assistantTurn = createConversationTurn({
    role: "assistant",
    text: input.answer,
    channel: input.channel,
    action: extracted.action,
    proposal: extracted.proposal,
    confirmationId: input.pendingConfirmation?.confirmationId ?? null,
    confirmationState: input.pendingConfirmation ? "pending" : "none",
  });
  const updatedSession = await save({
    ...input.session,
    currentChannel: input.channel,
    structuredHistory: appendTurn(historyWithUser, assistantTurn),
    pendingAction: input.pendingAction,
    pendingConfirmation: input.pendingConfirmation,
    interruptionState: input.session.interruptionState,
    lastMessageAt: new Date().toISOString(),
  });

  const result = buildTurnResult({
    session: updatedSession,
    channel: input.channel,
    answer: input.answer,
    brainResponse: input.brainResponse,
    role: input.role,
    permissions: input.permissions,
  });

  return { updatedSession, result };
}

function isFreshCalendarCommand(message: string): boolean {
  const extraction = parseCalendarIntent(message);
  return (
    extraction.intent === "cancel_appointment" ||
    extraction.intent === "move_appointment" ||
    extraction.intent === "create_appointment"
  );
}

async function resolvePendingIntentProposal(
  organizationId: string,
  intent: CalendarPendingIntent,
  session: ConversationSessionRecord
): Promise<NatalieClaudeResponse> {
  const activeContext = extractActiveCalendarContext({
    history: session.structuredHistory.map((turn) => ({
      role: turn.role,
      content: turn.text,
      action: turn.action,
      proposal: turn.proposal,
    })),
    pendingAction: session.pendingAction,
  });
  return fulfillCalendarPendingIntent(organizationId, intent, activeContext);
}

export async function tryHandleCalendarIntentContinuation(input: {
  session: ConversationSessionRecord;
  message: string;
  channel: NatalieChannel;
  organizationId: string;
  userId: string;
  requestId?: string | null;
  role?: string | null;
  permissions?: string[];
  saveSession?: typeof saveConversationSession;
}): Promise<{
  handled: boolean;
  result?: ProcessNatalieTurnResult;
  updatedSession?: ConversationSessionRecord;
}> {
  if (input.session.pendingConfirmation) {
    return { handled: false };
  }

  // Ordinal references to the last calendar list ("תבטלי את הראשון") must
  // reach the brain's lastListedAppointments handler — not pending-intent fill.
  if (parseListedAppointmentOrdinalCommand(input.message)) {
    return { handled: false };
  }

  const bareConfirmation = parseVoiceConfirmationIntent(input.message);
  if (
    bareConfirmation === "accept" &&
    !input.session.pendingConfirmation &&
    !readCalendarPendingIntent(input.session.pendingAction)
  ) {
    const answer = calendarMessages.bareYesWithoutPending();
    const persisted = await persistCalendarContinuationTurn({
      session: input.session,
      channel: input.channel,
      message: input.message,
      answer,
      pendingAction: input.session.pendingAction,
      pendingConfirmation: null,
      role: input.role,
      permissions: input.permissions,
      saveSession: input.saveSession,
    });
    return { handled: true, ...persisted };
  }

  let pending = readCalendarPendingIntent(input.session.pendingAction);
  if (pending && isCalendarPendingIntentExpired(pending)) {
    pending = null;
  }

  const initialExtraction = parseCalendarIntent(input.message);
  console.info("[natalie/flow] parser", {
    requestId: input.requestId ?? null,
    sessionId: input.session.id,
    source: "calendar_intent_continuation",
    intent: initialExtraction.intent,
    customerName: initialExtraction.customerName,
    dayReference: initialExtraction.dayReference,
    time: initialExtraction.time,
    missingFields: initialExtraction.missingFields,
    hadPendingIntent: Boolean(pending),
    followUpPhrase: isCalendarFollowUpPhrase(input.message),
  });

  if (pending && isFreshCalendarCommand(input.message)) {
    console.info("[natalie/flow] pending_intent_bypassed", {
      requestId: input.requestId ?? null,
      sessionId: input.session.id,
      reason: "fresh_calendar_command",
    });
    pending = null;
  }

  if (!pending) {
    const extraction = initialExtraction;
    if (
      extraction.intent === "cancel_appointment" &&
      extraction.cancelTarget === "all" &&
      extraction.missingFields.length === 0 &&
      extraction.dayReference
    ) {
      const completeIntent: CalendarPendingIntent = {
        intent: "cancel_appointment",
        action: "cancel_appointments",
        cancelTarget: "all",
        customerName: null,
        dayReference: extraction.dayReference,
        date: extraction.date,
        time: null,
        fromDayReference: null,
        fromTime: null,
        missingFields: [],
        originalUserText: input.message,
        lastAssistantQuestion: "",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
      const brainResponse = await resolvePendingIntentProposal(
        input.organizationId,
        completeIntent,
        input.session
      );
      const extracted = extractCalendarBrainResponse(brainResponse as Record<string, unknown>);
      const pendingConfirmation =
        extracted.action && extracted.proposal
          ? buildCalendarPendingConfirmation(
              extracted.action,
              extracted.proposal,
              input.channel,
              input.role,
              input.permissions
            )
          : null;
      const persisted = await persistCalendarContinuationTurn({
        session: input.session,
        channel: input.channel,
        message: input.message,
        answer: brainResponse.answer ?? "",
        brainResponse,
        pendingAction: null,
        pendingConfirmation,
        role: input.role,
        permissions: input.permissions,
        saveSession: input.saveSession,
      });
      return { handled: true, ...persisted };
    }

    const initial = parseInitialCalendarPendingIntent(input.message);
    if (!initial) {
      return { handled: false };
    }

    // A fresh move whose target is resolvable by the fuzzy/pronoun reschedule
    // builder (e.g. "תעביר את רוסי פיטון ליום חמישי") must NOT be intercepted as
    // "missing customer" here — the deterministic parser doesn't fuzzy-match
    // names, so let the main brain run its identity-confirmation reschedule flow.
    if (initial.intent === "move_appointment" && extractRescheduleAppointment(input.message)) {
      return { handled: false };
    }

    const answer = clarificationQuestionForIntent(parseCalendarIntent(input.message));
    console.info("[natalie/flow] fallback", {
      requestId: input.requestId ?? null,
      sessionId: input.session.id,
      source: "calendar_initial_clarification",
      answer,
      missingFields: extraction.missingFields,
    });
    const persisted = await persistCalendarContinuationTurn({
      session: input.session,
      channel: input.channel,
      message: input.message,
      answer,
      pendingAction: calendarPendingAction(initial),
      pendingConfirmation: null,
      role: input.role,
      permissions: input.permissions,
      saveSession: input.saveSession,
    });
    return { handled: true, ...persisted };
  }

  const merged = mergeCalendarPendingIntent(pending, input.message);
  merged.missingFields = recomputeMissingFields(merged);

  if (merged.missingFields.length > 0) {
    const answer = clarificationQuestionForIntent({
      intent: merged.intent,
      customerName: merged.customerName,
      dayReference: merged.dayReference,
      date: merged.date,
      time: merged.time,
      cancelTarget: merged.cancelTarget,
      missingFields: merged.missingFields,
      rawText: input.message,
      confidence: "low",
      durationMinutes: null,
      serviceName: null,
      notes: null,
    });
    console.info("[natalie/flow] fallback", {
      requestId: input.requestId ?? null,
      sessionId: input.session.id,
      source: "calendar_pending_merge_clarification",
      answer,
      missingFields: merged.missingFields,
    });
    merged.lastAssistantQuestion = answer;
    const persisted = await persistCalendarContinuationTurn({
      session: input.session,
      channel: input.channel,
      message: input.message,
      answer,
      pendingAction: calendarPendingAction(merged),
      pendingConfirmation: null,
      role: input.role,
      permissions: input.permissions,
      saveSession: input.saveSession,
    });
    return { handled: true, ...persisted };
  }

  const brainResponse = await resolvePendingIntentProposal(input.organizationId, merged, input.session);
  const extracted = extractCalendarBrainResponse(brainResponse as Record<string, unknown>);
  const pendingConfirmation =
    extracted.action && extracted.proposal
      ? buildCalendarPendingConfirmation(
          extracted.action,
          extracted.proposal,
          input.channel,
          input.role,
          input.permissions
        )
      : null;

  const persisted = await persistCalendarContinuationTurn({
    session: input.session,
    channel: input.channel,
    message: input.message,
    answer: brainResponse.answer ?? "",
    brainResponse,
    pendingAction: null,
    pendingConfirmation,
    role: input.role,
    permissions: input.permissions,
    saveSession: input.saveSession,
  });
  return { handled: true, ...persisted };
}
