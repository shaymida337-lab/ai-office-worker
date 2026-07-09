import { randomUUID } from "crypto";
import type { NatalieClaudeResponse } from "../claude.js";
import { askNatalieBusinessQuestion } from "../natalie.js";
import { resolveMembershipRole } from "../rbac/membership.js";
import {
  completeCoreWorkflowStage,
  createCoreWorkflowTrace,
  emitCoreWorkflowAudit,
  emitCoreWorkflowFailure,
  reportCoreWorkflowHealth,
} from "../reliability/core/index.js";
import { getChannelAdapter, normalizeChannelInput } from "./conversationAdapters.js";
import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import {
  appendTurn,
  createConversationTurn,
  extractActionFromBrainResponse,
  toBrainHistory,
} from "./conversationHistory.js";
import { recordConversationMetric } from "./conversationMetrics.js";
import { resolveConversationSession, saveConversationSession, sessionDurationMs } from "./conversationSession.js";
import type {
  NatalieModality,
  PendingConfirmation,
  ProcessNatalieTurnInput,
  ProcessNatalieTurnResult,
} from "./conversationTypes.js";
import { evaluateZeroWrongAction } from "./conversationZeroWrongAction.js";
import { tryHandleAvailabilityContinuation } from "./conversationAvailabilityContinuation.js";
import { tryHandleCalendarIntentContinuation } from "./conversationCalendarContinuation.js";
import {
  applyFuzzyCalendarClientResponse,
  buildCalendarPendingConfirmation,
  extractCalendarBrainResponse,
  extractCalendarSlotFilling,
  tryHandleCalendarConfirmationTurn,
} from "./calendarConfirmationContinuation.js";
import { calendarPendingAction } from "../calendar/calendarPendingIntent.js";
import { shouldDeferCalendarActionForFuzzyGate } from "../scheduling/calendarActionProposal.js";
import { LAST_LISTED_APPOINTMENTS_ACTION } from "./lastListedAppointments.js";
import {
  logPendingConfirmationEvent,
  newPendingConfirmationId,
  stampPendingConfirmation,
} from "./pendingConfirmationState.js";

export type ProcessNatalieTurnDeps = {
  ask?: typeof askNatalieBusinessQuestion;
  resolveSession?: typeof resolveConversationSession;
  saveSession?: typeof saveConversationSession;
};

function modalityForChannel(channel: ProcessNatalieTurnInput["channel"], modality?: NatalieModality): NatalieModality {
  if (modality) return modality;
  return channel === "web_voice" ? "voice" : "text";
}

function buildPendingConfirmation(
  action: string,
  proposal: Record<string, unknown>,
  confirmation: ReturnType<typeof evaluateConfirmationPolicy>
): PendingConfirmation | null {
  if (!confirmation.required) return null;
  return stampPendingConfirmation({
    confirmationId: newPendingConfirmationId(),
    action,
    proposal,
    confirmationType: confirmation.confirmationType,
    spokenPrompt: confirmation.spokenPrompt,
    uiPrompt: confirmation.uiPrompt,
  });
}

export async function processNatalieTurn(
  input: ProcessNatalieTurnInput,
  deps: ProcessNatalieTurnDeps = {}
): Promise<ProcessNatalieTurnResult> {
  const ask = deps.ask ?? askNatalieBusinessQuestion;
  const resolveSession = deps.resolveSession ?? resolveConversationSession;
  const saveSession = deps.saveSession ?? saveConversationSession;

  const channel = input.channel ?? "web_chat";
  const modality = modalityForChannel(channel, input.modality);
  const normalizedMessage = normalizeChannelInput(channel, input.message);
  const requestId = input.requestId ?? null;
  if (!normalizedMessage) {
    throw new Error("message is required");
  }

  const membership = input.role ? null : await resolveMembershipRole(input.userId, input.organizationId);
  const role = input.role ?? membership?.role ?? null;

  const session = await resolveSession({
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    userId: input.userId,
    channel,
    legacyHistory: input.legacyHistory,
  });

  const trace = createCoreWorkflowTrace({
    subsystem: "natalie_conversation",
    organizationId: input.organizationId,
    entityId: session.id,
    explicit: `natalie-conv:${session.id}`,
    workflow: "natalie_conversation",
  });
  const turnId = randomUUID();
  emitCoreWorkflowAudit(trace, "started", "turn", {
    metadata: { turnId, channel, modality },
  });

  try {
    console.info("[natalie/flow] message_received", {
      requestId,
      channel,
      modality,
      sessionId: session.id,
      message: normalizedMessage,
    });

    const logResponseSent = (source: string, answer: string) => {
      console.info("[natalie/flow] response_sent", {
        requestId,
        sessionId: session.id,
        source,
        answer,
      });
    };

    const calendarConfirmation = await tryHandleCalendarConfirmationTurn({
      session,
      message: normalizedMessage,
      channel,
      organizationId: input.organizationId,
      userId: input.userId,
      requestId,
      role,
      permissions: input.permissions,
    });
    const activeSession =
      calendarConfirmation.resetPendingConfirmation === true
        ? {
            ...session,
            pendingAction: null,
            pendingConfirmation: null,
          }
        : session;

    if (calendarConfirmation.handled && calendarConfirmation.result && calendarConfirmation.updatedSession) {
      const adapter = getChannelAdapter(channel);
      const continuation = calendarConfirmation.result;
      const displayResponse =
        continuation.displayResponse ??
        adapter.renderDisplay(continuation as NatalieClaudeResponse, continuation.confirmation);
      const spokenResponse =
        continuation.spokenResponse ??
        adapter.renderSpoken(continuation as NatalieClaudeResponse, continuation.confirmation);

      const updatedSession = await saveSession(calendarConfirmation.updatedSession);
      logResponseSent("calendar_confirmation", continuation.answer);

      completeCoreWorkflowStage(trace, "turn", "completed", {
        health: continuation.zeroWrongAction?.ready === false ? "Degraded" : "Healthy",
        metadata: { turnId, calendarConfirmation: true },
      });

      recordConversationMetric({
        sessionId: updatedSession.id,
        channel,
        turnCount: updatedSession.structuredHistory.length,
        confirmationRequired: continuation.confirmation?.required ?? false,
        recoveryCount: 0,
        interruptionCount: updatedSession.interruptionState?.interrupted ? 1 : 0,
        durationMs: sessionDurationMs(updatedSession),
        success: true,
      });

      return {
        ...continuation,
        conversationSessionId: updatedSession.id,
        displayResponse,
        spokenResponse,
        reliability: {
          correlationId: trace.correlationId,
          sessionId: updatedSession.id,
          turnId,
          health: continuation.zeroWrongAction?.ready === false ? "Degraded" : "Healthy",
        },
      };
    }

    const calendarIntentContinuation = await tryHandleCalendarIntentContinuation({
      session: activeSession,
      message: normalizedMessage,
      channel,
      organizationId: input.organizationId,
      userId: input.userId,
      requestId,
      role,
      permissions: input.permissions,
      saveSession,
    });
    if (calendarIntentContinuation.handled && calendarIntentContinuation.result && calendarIntentContinuation.updatedSession) {
      const adapter = getChannelAdapter(channel);
      const continuation = calendarIntentContinuation.result;
      const displayResponse =
        continuation.displayResponse ??
        adapter.renderDisplay(continuation as NatalieClaudeResponse, continuation.confirmation);
      const spokenResponse =
        continuation.spokenResponse ??
        adapter.renderSpoken(continuation as NatalieClaudeResponse, continuation.confirmation);

      const updatedSession = await saveSession(calendarIntentContinuation.updatedSession);
      logResponseSent("calendar_intent_continuation", continuation.answer);

      completeCoreWorkflowStage(trace, "turn", "completed", {
        health: continuation.zeroWrongAction?.ready === false ? "Degraded" : "Healthy",
        metadata: {
          turnId,
          action: "action" in continuation ? continuation.action : undefined,
          calendarIntentContinuation: true,
        },
      });

      recordConversationMetric({
        sessionId: updatedSession.id,
        channel,
        turnCount: updatedSession.structuredHistory.length,
        confirmationRequired: continuation.confirmation?.required ?? false,
        recoveryCount: 0,
        interruptionCount: updatedSession.interruptionState?.interrupted ? 1 : 0,
        durationMs: sessionDurationMs(updatedSession),
        success: true,
      });

      return {
        ...continuation,
        conversationSessionId: updatedSession.id,
        displayResponse,
        spokenResponse,
        reliability: {
          correlationId: trace.correlationId,
          sessionId: updatedSession.id,
          turnId,
          health: continuation.zeroWrongAction?.ready === false ? "Degraded" : "Healthy",
        },
      };
    }

    const availabilityContinuation = await tryHandleAvailabilityContinuation({
      session: activeSession,
      message: normalizedMessage,
      channel,
      role,
      permissions: input.permissions,
    });
    if (availabilityContinuation.handled && availabilityContinuation.result && availabilityContinuation.updatedSession) {
      const adapter = getChannelAdapter(channel);
      const continuation = availabilityContinuation.result;
      const displayResponse =
        continuation.displayResponse ??
        adapter.renderDisplay(continuation as NatalieClaudeResponse, continuation.confirmation);
      const spokenResponse =
        continuation.spokenResponse ??
        adapter.renderSpoken(continuation as NatalieClaudeResponse, continuation.confirmation);

      const updatedSession = await saveSession(availabilityContinuation.updatedSession);
      logResponseSent("availability_continuation", continuation.answer);

      completeCoreWorkflowStage(trace, "turn", "completed", {
        health: continuation.zeroWrongAction?.ready === false ? "Degraded" : "Healthy",
        metadata: {
          turnId,
          action: "action" in continuation ? continuation.action : undefined,
          availabilityContinuation: true,
        },
      });

      recordConversationMetric({
        sessionId: updatedSession.id,
        channel,
        turnCount: updatedSession.structuredHistory.length,
        confirmationRequired: continuation.confirmation?.required ?? false,
        recoveryCount: 0,
        interruptionCount: updatedSession.interruptionState?.interrupted ? 1 : 0,
        durationMs: sessionDurationMs(updatedSession),
        success: true,
      });

      return {
        ...continuation,
        conversationSessionId: updatedSession.id,
        displayResponse,
        spokenResponse,
        reliability: {
          correlationId: trace.correlationId,
          sessionId: updatedSession.id,
          turnId,
          health: continuation.zeroWrongAction?.ready === false ? "Degraded" : "Healthy",
        },
      };
    }

    const userTurn = createConversationTurn({
      role: "user",
      text: normalizedMessage,
      channel,
    });
    const historyWithUser = appendTurn(activeSession.structuredHistory, userTurn);
    const brainHistory = toBrainHistory(historyWithUser);

    console.info("[natalie/confirmation] generic_route_entered", {
      sessionId: activeSession.id,
      channel,
      hasPendingConfirmation: Boolean(activeSession.pendingConfirmation),
    });

    const brainResponse = await ask({
      organizationId: input.organizationId,
      question: normalizedMessage,
      requestId,
      history: brainHistory,
      conversationContext: {
        pendingAction: activeSession.pendingAction,
        structuredHistory: historyWithUser.map((turn) => ({
          role: turn.role,
          content: turn.text,
          action: turn.action,
          proposal: turn.proposal,
        })),
      },
    });

    const extracted = extractCalendarBrainResponse(brainResponse as Record<string, unknown>);
    const confirmation = evaluateConfirmationPolicy({
      action: extracted.action,
      channel,
      role,
      permissions: input.permissions,
    });

    const zeroWrongAction = evaluateZeroWrongAction({
      action: extracted.action,
      proposal: extracted.proposal,
      confirmation,
      intentText: normalizedMessage,
    });

    const adapter = getChannelAdapter(channel);
    let effectiveResponse: NatalieClaudeResponse = applyFuzzyCalendarClientResponse(
      brainResponse,
      extracted.proposal
    );
    if (!zeroWrongAction.ready && zeroWrongAction.followUpQuestion) {
      effectiveResponse = { answer: zeroWrongAction.followUpQuestion };
    } else if (!confirmation.allowed && extracted.action) {
      effectiveResponse = {
        answer: "אין לי הרשאה לבצע את הפעולה הזו. אפשר לעזור במשהו אחר?",
      };
    }

    const pendingConfirmation =
      extracted.action && extracted.proposal
        ? buildCalendarPendingConfirmation(
            extracted.action,
            extracted.proposal,
            channel,
            role,
            input.permissions
          )
        : null;
    if (pendingConfirmation) {
      logPendingConfirmationEvent("pending_created", {
        requestId,
        sessionId: activeSession.id,
        confirmationId: pendingConfirmation.confirmationId,
        createdAt: pendingConfirmation.createdAt,
        expiresAt: pendingConfirmation.expiresAt,
        source: "new",
      });
    }

    const displayResponse = adapter.renderDisplay(effectiveResponse, confirmation);
    const spokenResponse =
      pendingConfirmation?.spokenPrompt && shouldDeferCalendarActionForFuzzyGate(extracted.proposal)
        ? pendingConfirmation.spokenPrompt
        : adapter.renderSpoken(effectiveResponse, confirmation);

    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: displayResponse,
      channel,
      action: extracted.action,
      proposal: extracted.proposal,
      confirmationId: pendingConfirmation?.confirmationId ?? null,
      confirmationState: confirmation.required ? "pending" : "none",
    });

    const slotFilling = extractCalendarSlotFilling(brainResponse as Record<string, unknown>);
    const updatedSession = await saveSession({
      ...activeSession,
      currentChannel: channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction:
        extracted.action && extracted.proposal
          ? { action: extracted.action, proposal: extracted.proposal }
          : slotFilling
            ? calendarPendingAction(slotFilling)
            : activeSession.pendingAction?.action === LAST_LISTED_APPOINTMENTS_ACTION
              ? activeSession.pendingAction
              : null,
      pendingConfirmation,
      interruptionState: activeSession.interruptionState,
      lastMessageAt: new Date().toISOString(),
    });

    completeCoreWorkflowStage(trace, "turn", "completed", {
      health: zeroWrongAction.ready ? "Healthy" : "Degraded",
      metadata: {
        turnId,
        action: extracted.action,
        confirmationRequired: confirmation.required,
      },
    });

    recordConversationMetric({
      sessionId: updatedSession.id,
      channel,
      turnCount: updatedSession.structuredHistory.length,
      confirmationRequired: confirmation.required,
      recoveryCount: zeroWrongAction.ready ? 0 : 1,
      interruptionCount: updatedSession.interruptionState?.interrupted ? 1 : 0,
      durationMs: sessionDurationMs(updatedSession),
      success: true,
    });
    logResponseSent("generic_route", displayResponse);

    return {
      ...(effectiveResponse as NatalieClaudeResponse),
      conversationSessionId: updatedSession.id,
      displayResponse,
      spokenResponse,
      confirmation,
      zeroWrongAction,
      reliability: {
        correlationId: trace.correlationId,
        sessionId: updatedSession.id,
        turnId,
        health: zeroWrongAction.ready ? "Healthy" : "Degraded",
      },
    };
  } catch (error) {
    emitCoreWorkflowFailure(trace, "turn", error);
    reportCoreWorkflowHealth(trace, "Failed");
    recordConversationMetric({
      sessionId: session.id,
      channel,
      turnCount: session.structuredHistory.length,
      confirmationRequired: false,
      recoveryCount: 1,
      interruptionCount: session.interruptionState?.interrupted ? 1 : 0,
      durationMs: sessionDurationMs(session),
      success: false,
    });
    throw error;
  }
}
