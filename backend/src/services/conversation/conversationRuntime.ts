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
  return {
    action,
    proposal,
    confirmationType: confirmation.confirmationType,
    spokenPrompt: confirmation.spokenPrompt,
    uiPrompt: confirmation.uiPrompt,
    createdAt: new Date().toISOString(),
  };
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
    const availabilityContinuation = tryHandleAvailabilityContinuation({
      session,
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
    const historyWithUser = appendTurn(session.structuredHistory, userTurn);
    const brainHistory = toBrainHistory(historyWithUser);

    const brainResponse = await ask({
      organizationId: input.organizationId,
      question: normalizedMessage,
      history: brainHistory,
    });

    const extracted = extractActionFromBrainResponse(brainResponse as Record<string, unknown>);
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
    let effectiveResponse: NatalieClaudeResponse = brainResponse;
    if (!zeroWrongAction.ready && zeroWrongAction.followUpQuestion) {
      effectiveResponse = { answer: zeroWrongAction.followUpQuestion };
    } else if (!confirmation.allowed && extracted.action) {
      effectiveResponse = {
        answer: "אין לי הרשאה לבצע את הפעולה הזו. אפשר לעזור במשהו אחר?",
      };
    }

    const displayResponse = adapter.renderDisplay(effectiveResponse, confirmation);
    const spokenResponse = adapter.renderSpoken(effectiveResponse, confirmation);

    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: displayResponse,
      channel,
      action: extracted.action,
      proposal: extracted.proposal,
      confirmationState: confirmation.required ? "pending" : "none",
    });

    const pendingConfirmation =
      extracted.action && extracted.proposal
        ? buildPendingConfirmation(extracted.action, extracted.proposal, confirmation)
        : null;

    const updatedSession = await saveSession({
      ...session,
      currentChannel: channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction:
        extracted.action && extracted.proposal
          ? { action: extracted.action, proposal: extracted.proposal }
          : null,
      pendingConfirmation,
      interruptionState: session.interruptionState,
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
