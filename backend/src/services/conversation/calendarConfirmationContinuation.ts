import { randomUUID } from "crypto";
import type { NatalieClaudeResponse } from "../claude.js";
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
import { parseVoiceConfirmationIntent } from "./voice/voiceConfirmation.js";
import { executeNataliePendingProposal } from "./voice/natalieProposalExecution.js";
import {
  claimConfirmationExecution,
  releaseConfirmationExecution,
  saveSessionAfterConfirmationExecution,
  VOICE_ALREADY_EXECUTED_MESSAGE,
} from "./voice/voiceConfirmationExecution.js";
import {
  resolveCalendarConfirmationPrompt,
  shouldDeferCalendarActionForFuzzyGate,
} from "../scheduling/calendarActionProposal.js";
import { withIdentityConfirmedProposal } from "../scheduling/calendarAppointmentSafety.js";
import { evaluateVoiceExecutionReadiness } from "./voice/voiceZeroWrongAction.js";
import { hebrewSafetyFallback } from "./natalieSafetyEvaluation.js";
import {
  canReviseCalendarPendingConfirmation,
  extractCalendarConfirmationRevision,
  isCalendarConfirmationRevisionPhrase,
  reviseCalendarPendingProposal,
} from "./calendarConfirmationRevision.js";
import { parseCalendarIntent } from "../calendar/calendarIntentParser.js";
import {
  logPendingConfirmationEvent,
  newPendingConfirmationId,
  resolveActivePendingConfirmation,
  stampPendingConfirmation,
} from "./pendingConfirmationState.js";

const FRESH_CALENDAR_COMMAND_PREFIX =
  /^(?:קבע|קבעי|תקבע|תקבעי|תזמן|תזמני)(?:\s|$)/u;

function shouldBypassPendingConfirmationForFreshCalendarCommand(message: string): boolean {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (!FRESH_CALENDAR_COMMAND_PREFIX.test(normalized)) return false;
  const parsed = parseCalendarIntent(normalized);
  return parsed.intent === "create_appointment";
}

type CalendarConfirmationDeps = {
  saveSession?: typeof saveConversationSession;
  executePendingProposal?: typeof executeNataliePendingProposal;
  claimConfirmationExecutionFn?: typeof claimConfirmationExecution;
  releaseConfirmationExecutionFn?: typeof releaseConfirmationExecution;
  saveSessionAfterConfirmationExecutionFn?: typeof saveSessionAfterConfirmationExecution;
};

function buildPendingConfirmation(
  action: string,
  proposal: Record<string, unknown>,
  confirmation: ReturnType<typeof evaluateConfirmationPolicy>,
  spokenPromptOverride?: string | null
) {
  if (!confirmation.required && !spokenPromptOverride) return null;
  const spokenPrompt = spokenPromptOverride ?? confirmation.spokenPrompt;
  const uiPrompt = spokenPromptOverride ?? confirmation.uiPrompt;
  return stampPendingConfirmation({
    confirmationId: newPendingConfirmationId(),
    action,
    proposal,
    confirmationType: spokenPromptOverride ? ("hard" as const) : confirmation.confirmationType,
    spokenPrompt,
    uiPrompt,
  });
}

export async function tryHandleCalendarConfirmationTurn(input: {
  session: ConversationSessionRecord;
  message: string;
  channel: NatalieChannel;
  organizationId: string;
  userId: string;
  requestId?: string | null;
  role?: string | null;
  permissions?: string[];
  deps?: CalendarConfirmationDeps;
}): Promise<{
  handled: boolean;
  result?: ProcessNatalieTurnResult;
  updatedSession?: ConversationSessionRecord;
  resetPendingConfirmation?: boolean;
}> {
  if (!input.session.pendingConfirmation && !input.session.structuredHistory.some(
    (turn) => turn.role === "assistant" && turn.confirmationState === "pending"
  )) {
    return { handled: false };
  }

  const save = input.deps?.saveSession ?? saveConversationSession;
  const executePendingProposal = input.deps?.executePendingProposal ?? executeNataliePendingProposal;
  const claimConfirmation =
    input.deps?.claimConfirmationExecutionFn ?? claimConfirmationExecution;
  const releaseConfirmation =
    input.deps?.releaseConfirmationExecutionFn ?? releaseConfirmationExecution;
  const saveAfterConfirmation =
    input.deps?.saveSessionAfterConfirmationExecutionFn ?? saveSessionAfterConfirmationExecution;

  if (shouldBypassPendingConfirmationForFreshCalendarCommand(input.message)) {
    logPendingConfirmationEvent("pending_replaced", {
      requestId: input.requestId,
      sessionId: input.session.id,
      confirmationId: input.session.pendingConfirmation?.confirmationId ?? null,
      createdAt: input.session.pendingConfirmation?.createdAt ?? null,
      expiresAt: input.session.pendingConfirmation?.expiresAt ?? null,
      reason: "fresh_calendar_command",
    });
    return {
      handled: false,
      resetPendingConfirmation: true,
    };
  }

  const intent = parseVoiceConfirmationIntent(input.message);
  const resolved = resolveActivePendingConfirmation({
    session: input.session,
    channel: input.channel,
    role: input.role,
    permissions: input.permissions,
  });

  if (!resolved.pending) {
    if (resolved.hadExpiredSessionPending && (intent === "accept" || intent === "reject" || intent === "cancel")) {
      const answer = "פג תוקף האישור הקודם. אפשר לבקש שוב את הפעולה ולאשר מחדש.";
      const userTurn = createConversationTurn({
        role: "user",
        text: input.message,
        channel: input.channel,
      });
      const historyWithUser = appendTurn(input.session.structuredHistory, userTurn);
      const assistantTurn = createConversationTurn({
        role: "assistant",
        text: answer,
        channel: input.channel,
        confirmationState: "rejected",
      });
      const updatedSession = await save({
        ...input.session,
        currentChannel: input.channel,
        structuredHistory: appendTurn(historyWithUser, assistantTurn),
        pendingAction: null,
        pendingConfirmation: null,
        interruptionState: input.session.interruptionState,
        lastMessageAt: new Date().toISOString(),
      });
      logPendingConfirmationEvent("pending_rejected", {
        requestId: input.requestId,
        sessionId: input.session.id,
        confirmationId: input.session.pendingConfirmation?.confirmationId ?? null,
        createdAt: input.session.pendingConfirmation?.createdAt ?? null,
        expiresAt: input.session.pendingConfirmation?.expiresAt ?? null,
        reason: "expired",
      });
      return {
        handled: true,
        updatedSession,
        result: {
          answer,
          conversationSessionId: updatedSession.id,
          displayResponse: answer,
          spokenResponse: answer,
          confirmation: evaluateConfirmationPolicy({
            action: null,
            channel: input.channel,
            role: input.role,
            permissions: input.permissions,
          }),
          zeroWrongAction: { ready: true, violations: [] },
          reliability: {
            correlationId: randomUUID(),
            sessionId: updatedSession.id,
            turnId: randomUUID(),
            health: "Healthy",
          },
        },
      };
    }

    if (resolved.hadExpiredSessionPending) {
      logPendingConfirmationEvent("pending_replaced", {
        requestId: input.requestId,
        sessionId: input.session.id,
        confirmationId: input.session.pendingConfirmation?.confirmationId ?? null,
        createdAt: input.session.pendingConfirmation?.createdAt ?? null,
        expiresAt: input.session.pendingConfirmation?.expiresAt ?? null,
        reason: "expired_cleared_for_new_turn",
      });
      return { handled: false, resetPendingConfirmation: true };
    }

    return { handled: false };
  }

  let pending = resolved.pending;
  logPendingConfirmationEvent("pending_loaded", {
    requestId: input.requestId,
    sessionId: input.session.id,
    confirmationId: pending.confirmationId,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    source: resolved.source === "none" ? null : resolved.source,
    reason: resolved.hadExpiredSessionPending ? "recovered_from_history" : null,
  });

  if (resolved.hadExpiredSessionPending && resolved.source === "history") {
    await save({
      ...input.session,
      pendingConfirmation: pending,
      pendingAction: { action: pending.action, proposal: pending.proposal },
    });
  }
  const revision =
    intent === "none" &&
    canReviseCalendarPendingConfirmation(pending.action) &&
    isCalendarConfirmationRevisionPhrase(input.message)
      ? extractCalendarConfirmationRevision(input.message)
      : null;

  const userTurn = createConversationTurn({
    role: "user",
    text: input.message,
    channel: input.channel,
  });
  const historyWithUser = appendTurn(input.session.structuredHistory, userTurn);

  if (revision) {
    const revised = reviseCalendarPendingProposal(pending.action, pending.proposal, revision);
    if ("clarify" in revised) {
      const answer = revised.clarify;
      const assistantTurn = createConversationTurn({
        role: "assistant",
        text: answer,
        channel: input.channel,
        confirmationState: "pending",
      });
      const updatedSession = await save({
        ...input.session,
        currentChannel: input.channel,
        structuredHistory: appendTurn(historyWithUser, assistantTurn),
        lastMessageAt: new Date().toISOString(),
      });
      return {
        handled: true,
        updatedSession,
        result: {
          answer,
          conversationSessionId: updatedSession.id,
          displayResponse: answer,
          spokenResponse: answer,
          confirmation: evaluateConfirmationPolicy({
            action: pending.action,
            channel: input.channel,
            role: input.role,
            permissions: input.permissions,
          }),
          zeroWrongAction: { ready: true, violations: [] },
          reliability: {
            correlationId: randomUUID(),
            sessionId: updatedSession.id,
            turnId: randomUUID(),
            health: "Healthy",
          },
        },
      };
    }

    const nextPending = buildCalendarPendingConfirmation(
      pending.action,
      revised.proposal,
      input.channel,
      input.role,
      input.permissions
    );
    const answer = revised.answer;
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: answer,
      channel: input.channel,
      action: pending.action,
      proposal: revised.proposal,
      confirmationId: nextPending?.confirmationId ?? null,
      confirmationState: "pending",
    });
    const updatedSession = await save({
      ...input.session,
      currentChannel: input.channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction: { action: pending.action, proposal: revised.proposal },
      pendingConfirmation: nextPending,
      interruptionState: input.session.interruptionState,
      lastMessageAt: new Date().toISOString(),
    });
    return {
      handled: true,
      updatedSession,
      result: {
        answer,
        conversationSessionId: updatedSession.id,
        displayResponse: answer,
        spokenResponse: answer,
        confirmation: evaluateConfirmationPolicy({
          action: pending.action,
          channel: input.channel,
          role: input.role,
          permissions: input.permissions,
        }),
        zeroWrongAction: { ready: true, violations: [] },
        reliability: {
          correlationId: randomUUID(),
          sessionId: updatedSession.id,
          turnId: randomUUID(),
          health: "Healthy",
        },
      },
    };
  }

  if (intent === "reject" || intent === "cancel") {
    const answer =
      intent === "cancel" ? "בסדר, ביטלתי את הפעולה הממתינה." : "בסדר, לא אבצע את הפעולה.";
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: answer,
      channel: input.channel,
      confirmationState: "rejected",
    });
    const updatedSession = await save({
      ...input.session,
      currentChannel: input.channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction: null,
      pendingConfirmation: null,
      interruptionState: input.session.interruptionState,
      lastMessageAt: new Date().toISOString(),
    });
    console.info("[natalie/confirmation] pending_cancelled", {
      sessionId: input.session.id,
      action: pending.action,
      confirmationId: pending.confirmationId,
      reason: intent,
    });
    logPendingConfirmationEvent("pending_rejected", {
      requestId: input.requestId,
      sessionId: input.session.id,
      confirmationId: pending.confirmationId,
      createdAt: pending.createdAt,
      expiresAt: pending.expiresAt,
      reason: intent,
    });
    const confirmation = evaluateConfirmationPolicy({
      action: null,
      channel: input.channel,
      role: input.role,
      permissions: input.permissions,
    });
    return {
      handled: true,
      updatedSession,
      result: {
        answer,
        conversationSessionId: updatedSession.id,
        displayResponse: answer,
        spokenResponse: answer,
        confirmation,
        zeroWrongAction: { ready: true, violations: [] },
        reliability: {
          correlationId: randomUUID(),
          sessionId: updatedSession.id,
          turnId: randomUUID(),
          health: "Healthy",
        },
      },
    };
  }

  if (intent !== "accept") {
    return { handled: false };
  }

  const readiness = evaluateVoiceExecutionReadiness({
    session: input.session,
    pendingConfirmation: pending,
    role: input.role,
    permissions: input.permissions,
  });
  if (!readiness.ready) {
    const answer = readiness.followUpQuestion ?? hebrewSafetyFallback(readiness.violations);
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: answer,
      channel: input.channel,
      confirmationState: "pending",
    });
    const updatedSession = await save({
      ...input.session,
      currentChannel: input.channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      lastMessageAt: new Date().toISOString(),
    });
    return {
      handled: true,
      updatedSession,
      result: {
        answer,
        conversationSessionId: updatedSession.id,
        displayResponse: answer,
        spokenResponse: answer,
        confirmation: evaluateConfirmationPolicy({
          action: pending.action,
          channel: input.channel,
          role: input.role,
          permissions: input.permissions,
        }),
        zeroWrongAction: readiness,
        reliability: {
          correlationId: randomUUID(),
          sessionId: updatedSession.id,
          turnId: randomUUID(),
          health: "Degraded",
        },
      },
    };
  }

  const confirmationId =
    pending.confirmationId ?? `legacy:${input.session.id}:${pending.createdAt}`;
  const claim = await claimConfirmation({
    organizationId: input.organizationId,
    userId: input.userId,
    sessionId: input.session.id,
    confirmationId,
    action: pending.action,
  });

  if (claim.mode === "replay") {
    const answer =
      claim.record.status === "completed"
        ? claim.record.resultMessage ?? VOICE_ALREADY_EXECUTED_MESSAGE
        : claim.record.resultMessage ?? hebrewSafetyFallback(["execution_failed"]);
    return {
      handled: true,
      updatedSession: input.session,
      result: {
        answer,
        conversationSessionId: input.session.id,
        displayResponse: answer,
        spokenResponse: answer,
        confirmation: evaluateConfirmationPolicy({
          action: null,
          channel: input.channel,
          role: input.role,
          permissions: input.permissions,
        }),
        zeroWrongAction: { ready: true, violations: [] },
        reliability: {
          correlationId: randomUUID(),
          sessionId: input.session.id,
          turnId: randomUUID(),
          health: "Healthy",
        },
      },
    };
  }

  const executableProposal = withIdentityConfirmedProposal(pending.proposal);
  let execution;
  try {
    execution = await executePendingProposal({
      organizationId: input.organizationId,
      userId: input.userId,
      action: pending.action,
      proposal: executableProposal,
    });
  } catch (error) {
    if (claim.mode === "claimed") {
      await releaseConfirmation(claim.recordId);
    }
    throw error;
  }

  if (!execution.ok && claim.mode === "claimed") {
    await releaseConfirmation(claim.recordId);
  }

  const answer = execution.message;
  const assistantTurn = createConversationTurn({
    role: "assistant",
    text: answer,
    channel: input.channel,
    action: pending.action,
    proposal: executableProposal,
    confirmationState: execution.ok ? "confirmed" : "rejected",
  });
  const structuredHistory = appendTurn(historyWithUser, assistantTurn);

  let updatedSession: ConversationSessionRecord;
  if (execution.ok && claim.mode === "claimed") {
    await saveAfterConfirmation({
      sessionId: input.session.id,
      organizationId: input.organizationId,
      userId: input.userId,
      recordId: claim.recordId,
      ok: true,
      resultMessage: answer,
      resultPayload: execution.payload,
      sessionPatch: {
        currentChannel: input.channel,
        structuredHistory,
        pendingAction: null,
        pendingConfirmation: null,
        interruptionState: input.session.interruptionState,
        lastMessageAt: new Date().toISOString(),
      },
    });
    updatedSession = {
      ...input.session,
      currentChannel: input.channel,
      structuredHistory,
      pendingAction: null,
      pendingConfirmation: null,
      lastMessageAt: new Date().toISOString(),
    };
    console.info("[natalie/confirmation] pending_executed", {
      sessionId: input.session.id,
      action: pending.action,
      confirmationId: pending.confirmationId,
      ok: true,
    });
    logPendingConfirmationEvent("pending_consumed", {
      requestId: input.requestId,
      sessionId: input.session.id,
      confirmationId: pending.confirmationId,
      createdAt: pending.createdAt,
      expiresAt: pending.expiresAt,
      consumedAt: new Date().toISOString(),
      reason: "accepted",
    });
  } else {
    updatedSession = await save({
      ...input.session,
      currentChannel: input.channel,
      structuredHistory,
      pendingAction: execution.ok ? null : input.session.pendingAction,
      pendingConfirmation: execution.ok ? null : input.session.pendingConfirmation,
      interruptionState: input.session.interruptionState,
      lastMessageAt: new Date().toISOString(),
    });
    if (!execution.ok) {
      console.info("[natalie/confirmation] pending_executed", {
        sessionId: input.session.id,
        action: pending.action,
        confirmationId: pending.confirmationId,
        ok: false,
      });
    }
  }

  const confirmation = evaluateConfirmationPolicy({
    action: null,
    channel: input.channel,
    role: input.role,
    permissions: input.permissions,
  });
  return {
    handled: true,
    updatedSession,
    result: {
      answer,
      conversationSessionId: updatedSession.id,
      displayResponse: answer,
      spokenResponse: answer,
      confirmation,
      zeroWrongAction: {
        ready: execution.ok,
        violations: execution.ok ? [] : ["execution_failed"],
      },
      reliability: {
        correlationId: randomUUID(),
        sessionId: updatedSession.id,
        turnId: randomUUID(),
        health: execution.ok ? "Healthy" : "Failed",
      },
    },
  };
}

export function applyFuzzyCalendarClientResponse(
  brainResponse: NatalieClaudeResponse,
  proposal: Record<string, unknown> | null
): NatalieClaudeResponse {
  if (!shouldDeferCalendarActionForFuzzyGate(proposal)) return brainResponse;
  const answer = resolveCalendarConfirmationPrompt(proposal!) ?? ("answer" in brainResponse ? brainResponse.answer : "");
  return { answer };
}

export function buildCalendarPendingConfirmation(
  action: string,
  proposal: Record<string, unknown>,
  channel: NatalieChannel,
  role?: string | null,
  permissions?: string[]
) {
  const confirmation = evaluateConfirmationPolicy({ action, channel, role, permissions });
  const fuzzyPrompt = resolveCalendarConfirmationPrompt(proposal);
  return buildPendingConfirmation(action, proposal, confirmation, fuzzyPrompt);
}

export function extractCalendarBrainResponse(
  brainResponse: Record<string, unknown>
): { action: string | null; proposal: Record<string, unknown> | null; answer: string } {
  const extracted = extractActionFromBrainResponse(brainResponse);
  if (!shouldDeferCalendarActionForFuzzyGate(extracted.proposal)) return extracted;
  return {
    action: extracted.action,
    proposal: extracted.proposal,
    answer: resolveCalendarConfirmationPrompt(extracted.proposal!) ?? extracted.answer,
  };
}

export function extractCalendarSlotFilling(
  brainResponse: Record<string, unknown>
): import("../calendar/calendarPendingIntent.js").CalendarPendingIntent | null {
  const raw = brainResponse.calendarSlotFilling;
  if (!raw || typeof raw !== "object") return null;
  const intent = raw as import("../calendar/calendarPendingIntent.js").CalendarPendingIntent;
  if (!intent.intent || !intent.expiresAt) return null;
  return intent;
}
