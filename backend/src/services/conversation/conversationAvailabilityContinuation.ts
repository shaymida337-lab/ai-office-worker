import type { NatalieClaudeResponse } from "../claude.js";
import type { SuggestAvailableTimesProposal } from "../natalieAvailability.js";
import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import { appendTurn, createConversationTurn } from "./conversationHistory.js";
import type {
  ConversationSessionRecord,
  NatalieChannel,
  PendingConfirmation,
  ProcessNatalieTurnResult,
} from "./conversationTypes.js";
import { evaluateZeroWrongAction } from "./conversationZeroWrongAction.js";
import { parseVoiceConfirmationIntent } from "./voice/voiceConfirmation.js";
import {
  parseSlotLabelParts,
  resolveAvailabilitySlotFromUtterance,
  type AvailabilitySlotLike,
} from "./availabilitySlotSelection.js";

export type AvailabilityContinuationPhase = "awaiting_slot" | "awaiting_client_name";

export type AvailabilityContinuationState = {
  phase: AvailabilityContinuationPhase;
  proposal: SuggestAvailableTimesProposal;
  selectedSlot?: AvailabilitySlotLike;
};

export type BookAppointmentProposal = {
  clientName: string;
  startTime: string;
  durationMinutes: number;
  serviceName?: string;
};

function isSuggestAvailableTimesProposal(
  proposal: Record<string, unknown> | null | undefined
): proposal is SuggestAvailableTimesProposal {
  return Boolean(proposal && Array.isArray(proposal.slots));
}

function readContinuationState(session: ConversationSessionRecord): AvailabilityContinuationState | null {
  const pending = session.pendingAction;
  if (!pending) return null;

  if (pending.action === "availability_continuation") {
    const raw = pending.proposal as {
      phase?: AvailabilityContinuationPhase;
      proposal?: SuggestAvailableTimesProposal;
      selectedSlot?: AvailabilitySlotLike;
    };
    if (raw.phase && raw.proposal && Array.isArray(raw.proposal.slots)) {
      return {
        phase: raw.phase,
        proposal: raw.proposal,
        selectedSlot: raw.selectedSlot,
      };
    }
  }

  if (pending.action === "suggest_available_times" && isSuggestAvailableTimesProposal(pending.proposal)) {
    return {
      phase: "awaiting_slot",
      proposal: pending.proposal,
    };
  }

  return null;
}

function continuationPendingAction(state: AvailabilityContinuationState): ConversationSessionRecord["pendingAction"] {
  return {
    action: "availability_continuation",
    proposal: {
      phase: state.phase,
      proposal: state.proposal,
      selectedSlot: state.selectedSlot,
    },
  };
}

function buildBookingConfirmationAnswer(params: {
  clientName: string;
  slot: AvailabilitySlotLike;
}): string {
  const { dayLabel, timeLabel } = parseSlotLabelParts(params.slot.label);
  const when = dayLabel && timeLabel ? `${dayLabel} ב־${timeLabel}` : params.slot.label;
  return `מעולה. לקבוע עם ${params.clientName} ${when}?`;
}

function buildBookProposal(params: {
  clientName: string;
  slot: AvailabilitySlotLike;
  serviceName?: string;
}): BookAppointmentProposal {
  return {
    clientName: params.clientName.trim(),
    startTime: params.slot.startTime,
    durationMinutes: params.slot.durationMinutes,
    ...(params.serviceName ? { serviceName: params.serviceName } : {}),
  };
}

function buildPendingConfirmation(
  proposal: BookAppointmentProposal,
  confirmation: ReturnType<typeof evaluateConfirmationPolicy>
): PendingConfirmation {
  return {
    action: "book_appointment",
    proposal,
    confirmationType: confirmation.confirmationType,
    spokenPrompt: "",
    uiPrompt: confirmation.uiPrompt,
    createdAt: new Date().toISOString(),
  };
}

function buildTurnResult(params: {
  session: ConversationSessionRecord;
  channel: NatalieChannel;
  assistantText: string;
  brainResponse: NatalieClaudeResponse;
  pendingAction: ConversationSessionRecord["pendingAction"];
  pendingConfirmation: PendingConfirmation | null;
  historyWithUser: ReturnType<typeof appendTurn>;
}): {
  result: ProcessNatalieTurnResult;
  updatedSession: ConversationSessionRecord;
} {
  const assistantTurn = createConversationTurn({
    role: "assistant",
    text: params.assistantText,
    channel: params.channel,
    action: "action" in params.brainResponse ? params.brainResponse.action : undefined,
    proposal:
      "proposal" in params.brainResponse && params.brainResponse.proposal
        ? (params.brainResponse.proposal as Record<string, unknown>)
        : undefined,
    confirmationState: params.pendingConfirmation ? "pending" : "none",
  });

  const updatedSession: ConversationSessionRecord = {
    ...params.session,
    currentChannel: params.channel,
    structuredHistory: appendTurn(params.historyWithUser, assistantTurn),
    pendingAction: params.pendingAction,
    pendingConfirmation: params.pendingConfirmation,
    lastMessageAt: new Date().toISOString(),
  };

  return {
    result: {
      ...params.brainResponse,
      conversationSessionId: params.session.id,
      displayResponse: params.assistantText,
      spokenResponse: params.assistantText,
      confirmation: {
        required: Boolean(params.pendingConfirmation),
        confirmationType: params.pendingConfirmation?.confirmationType ?? "none",
        riskLevel: params.pendingConfirmation ? "reversible" : "read_only",
        spokenPrompt: params.pendingConfirmation?.spokenPrompt ?? "",
        uiPrompt: params.pendingConfirmation?.uiPrompt ?? "",
        allowed: true,
      },
      zeroWrongAction: { ready: true, violations: [] },
      reliability: {
        correlationId: `availability:${params.session.id}`,
        sessionId: params.session.id,
        turnId: `availability`,
        health: "Healthy",
      },
    },
    updatedSession,
  };
}

export function tryHandleAvailabilityContinuation(input: {
  session: ConversationSessionRecord;
  message: string;
  channel: NatalieChannel;
  role?: string | null;
  permissions?: string[];
}): {
  handled: boolean;
  result?: ProcessNatalieTurnResult;
  updatedSession?: ConversationSessionRecord;
} {
  if (input.session.pendingConfirmation) {
    return { handled: false };
  }

  const continuation = readContinuationState(input.session);
  if (!continuation) {
    return { handled: false };
  }

  const confirmationIntent = parseVoiceConfirmationIntent(input.message);
  if (confirmationIntent === "cancel" || confirmationIntent === "reject") {
    const spokenResponse =
      confirmationIntent === "cancel" ? "בסדר, ביטלתי את בחירת המועד." : "בסדר, לא נקבע תור.";
    const userTurn = createConversationTurn({
      role: "user",
      text: input.message,
      channel: input.channel,
    });
    const historyWithUser = appendTurn(input.session.structuredHistory, userTurn);
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: spokenResponse,
      channel: input.channel,
      confirmationState: "rejected",
    });
    const updatedSession: ConversationSessionRecord = {
      ...input.session,
      currentChannel: input.channel,
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction: null,
      pendingConfirmation: null,
      lastMessageAt: new Date().toISOString(),
    };
    return {
      handled: true,
      result: {
        answer: spokenResponse,
        conversationSessionId: updatedSession.id,
        displayResponse: spokenResponse,
        spokenResponse,
        confirmation: {
          required: false,
          confirmationType: "none",
          riskLevel: "read_only",
          spokenPrompt: "",
          uiPrompt: "",
          allowed: true,
        },
        zeroWrongAction: { ready: true, violations: [] },
        reliability: {
          correlationId: `availability-cancel:${updatedSession.id}`,
          sessionId: updatedSession.id,
          turnId: `availability-cancel`,
          health: "Healthy",
        },
      },
      updatedSession,
    };
  }

  const userTurn = createConversationTurn({
    role: "user",
    text: input.message,
    channel: input.channel,
  });
  const historyWithUser = appendTurn(input.session.structuredHistory, userTurn);

  if (continuation.phase === "awaiting_client_name" && continuation.selectedSlot) {
    const clientName = input.message.trim();
    if (!clientName || confirmationIntent !== "none") {
      const clarify = "למי לקבוע את התור? אפשר לומר את שם הלקוח.";
      const { result, updatedSession } = buildTurnResult({
        session: input.session,
        channel: input.channel,
        assistantText: clarify,
        brainResponse: { answer: clarify },
        pendingAction: continuationPendingAction(continuation),
        pendingConfirmation: null,
        historyWithUser,
      });
      return { handled: true, result, updatedSession };
    }

    const bookProposal = buildBookProposal({
      clientName,
      slot: continuation.selectedSlot,
      serviceName: continuation.proposal.clientName ? undefined : undefined,
    });
    const confirmation = evaluateConfirmationPolicy({
      action: "book_appointment",
      channel: input.channel,
      role: input.role,
      permissions: input.permissions,
    });
    const zeroWrongAction = evaluateZeroWrongAction({
      action: "book_appointment",
      proposal: bookProposal,
      confirmation,
      intentText: input.message,
    });
    if (!confirmation.allowed) {
      const denied = "אין לי הרשאה לקבוע תורים. אפשר לעזור במשהו אחר?";
      const { result, updatedSession } = buildTurnResult({
        session: input.session,
        channel: input.channel,
        assistantText: denied,
        brainResponse: { answer: denied },
        pendingAction: null,
        pendingConfirmation: null,
        historyWithUser,
      });
      return { handled: true, result, updatedSession };
    }

    const answer = buildBookingConfirmationAnswer({ clientName, slot: continuation.selectedSlot });
    const pendingConfirmation = buildPendingConfirmation(bookProposal, confirmation);
    const brainResponse = {
      action: "book_appointment" as const,
      proposal: bookProposal,
      answer,
    };
    const { result, updatedSession } = buildTurnResult({
      session: input.session,
      channel: input.channel,
      assistantText: answer,
      brainResponse,
      pendingAction: { action: "book_appointment", proposal: bookProposal },
      pendingConfirmation,
      historyWithUser,
    });
    return {
      handled: true,
      result: {
        ...result,
        confirmation,
        zeroWrongAction,
      },
      updatedSession,
    };
  }

  const resolution = resolveAvailabilitySlotFromUtterance(input.message, continuation.proposal.slots);
  if (resolution.kind === "ambiguous") {
    const { result, updatedSession } = buildTurnResult({
      session: input.session,
      channel: input.channel,
      assistantText: resolution.message,
      brainResponse: { answer: resolution.message },
      pendingAction: continuationPendingAction(continuation),
      pendingConfirmation: null,
      historyWithUser,
    });
    return { handled: true, result, updatedSession };
  }

  if (resolution.kind === "none") {
    return { handled: false };
  }

  const selectedSlot = resolution.slot;
  const clientName = continuation.proposal.clientName?.trim();
  if (!clientName) {
    const askClient = `מעולה, ${selectedSlot.label}. למי לקבוע את התור?`;
    const nextState: AvailabilityContinuationState = {
      phase: "awaiting_client_name",
      proposal: continuation.proposal,
      selectedSlot,
    };
    const { result, updatedSession } = buildTurnResult({
      session: input.session,
      channel: input.channel,
      assistantText: askClient,
      brainResponse: { answer: askClient },
      pendingAction: continuationPendingAction(nextState),
      pendingConfirmation: null,
      historyWithUser,
    });
    return { handled: true, result, updatedSession };
  }

  const bookProposal = buildBookProposal({
    clientName,
    slot: selectedSlot,
  });
  const confirmation = evaluateConfirmationPolicy({
    action: "book_appointment",
    channel: input.channel,
    role: input.role,
    permissions: input.permissions,
  });
  const zeroWrongAction = evaluateZeroWrongAction({
    action: "book_appointment",
    proposal: bookProposal,
    confirmation,
    intentText: input.message,
  });
  if (!confirmation.allowed) {
    const denied = "אין לי הרשאה לקבוע תורים. אפשר לעזור במשהו אחר?";
    const { result, updatedSession } = buildTurnResult({
      session: input.session,
      channel: input.channel,
      assistantText: denied,
      brainResponse: { answer: denied },
      pendingAction: null,
      pendingConfirmation: null,
      historyWithUser,
    });
    return { handled: true, result, updatedSession };
  }

  const answer = buildBookingConfirmationAnswer({ clientName, slot: selectedSlot });
  const pendingConfirmation = buildPendingConfirmation(bookProposal, confirmation);
  const brainResponse = {
    action: "book_appointment" as const,
    proposal: bookProposal,
    answer,
  };
  const { result, updatedSession } = buildTurnResult({
    session: input.session,
    channel: input.channel,
    assistantText: answer,
    brainResponse,
    pendingAction: { action: "book_appointment", proposal: bookProposal },
    pendingConfirmation,
    historyWithUser,
  });
  return {
    handled: true,
    result: {
      ...result,
      confirmation,
      zeroWrongAction,
    },
    updatedSession,
  };
}
