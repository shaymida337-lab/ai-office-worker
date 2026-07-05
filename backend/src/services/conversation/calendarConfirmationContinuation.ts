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
  resolveCalendarConfirmationPrompt,
  shouldDeferCalendarActionForFuzzyGate,
} from "../scheduling/calendarActionProposal.js";
import {
  withIdentityConfirmedProposal,
} from "../scheduling/calendarAppointmentSafety.js";

function buildPendingConfirmation(
  action: string,
  proposal: Record<string, unknown>,
  confirmation: ReturnType<typeof evaluateConfirmationPolicy>,
  spokenPromptOverride?: string | null
) {
  if (!confirmation.required && !spokenPromptOverride) return null;
  const spokenPrompt = spokenPromptOverride ?? confirmation.spokenPrompt;
  const uiPrompt = spokenPromptOverride ?? confirmation.uiPrompt;
  return {
    confirmationId: randomUUID(),
    action,
    proposal,
    confirmationType: spokenPromptOverride ? ("hard" as const) : confirmation.confirmationType,
    spokenPrompt,
    uiPrompt,
    createdAt: new Date().toISOString(),
  };
}

export async function tryHandleCalendarConfirmationTurn(input: {
  session: ConversationSessionRecord;
  message: string;
  channel: NatalieChannel;
  organizationId: string;
  userId: string;
  role?: string | null;
  permissions?: string[];
}): Promise<{
  handled: boolean;
  result?: ProcessNatalieTurnResult;
  updatedSession?: ConversationSessionRecord;
}> {
  const pending = input.session.pendingConfirmation;
  if (!pending) return { handled: false };

  const intent = parseVoiceConfirmationIntent(input.message);
  const userTurn = createConversationTurn({
    role: "user",
    text: input.message,
    channel: input.channel,
  });
  const historyWithUser = appendTurn(input.session.structuredHistory, userTurn);

  if (intent === "reject" || intent === "cancel") {
    const answer =
      intent === "cancel" ? "בסדר, ביטלתי את הפעולה הממתינה." : "בסדר, לא אבצע את הפעולה.";
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: answer,
      channel: input.channel,
      confirmationState: "rejected",
    });
    const updatedSession = await saveConversationSession({
      ...input.session,
      currentChannel: input.channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction: null,
      pendingConfirmation: null,
      interruptionState: input.session.interruptionState,
      lastMessageAt: new Date().toISOString(),
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

  if (intent !== "accept") return { handled: false };

  const executableProposal = withIdentityConfirmedProposal(pending.proposal);
  const execution = await executeNataliePendingProposal({
    organizationId: input.organizationId,
    userId: input.userId,
    action: pending.action,
    proposal: executableProposal,
  });
  const answer = execution.message;
  const assistantTurn = createConversationTurn({
    role: "assistant",
    text: answer,
    channel: input.channel,
    action: pending.action,
    proposal: executableProposal,
    confirmationState: execution.ok ? "confirmed" : "rejected",
  });
  const updatedSession = await saveConversationSession({
    ...input.session,
    currentChannel: input.channel,
    structuredHistory: appendTurn(historyWithUser, assistantTurn),
    pendingAction: null,
    pendingConfirmation: null,
    interruptionState: input.session.interruptionState,
    lastMessageAt: new Date().toISOString(),
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
