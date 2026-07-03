import { randomUUID } from "crypto";
import {
  completeCoreWorkflowStage,
  createCoreWorkflowTrace,
  emitCoreWorkflowAudit,
  emitCoreWorkflowFailure,
  reportCoreWorkflowHealth,
} from "../../reliability/core/index.js";
import { resolveMembershipRole } from "../../rbac/membership.js";
import { appendTurn, createConversationTurn } from "../conversationHistory.js";
import { processNatalieTurn, type ProcessNatalieTurnDeps } from "../conversationRuntime.js";
import { getConversationSession, saveConversationSession } from "../conversationSession.js";
import type { ProcessNatalieTurnResult } from "../conversationTypes.js";
import { normalizeChannelInput } from "../conversationAdapters.js";
import { executeNataliePendingProposal } from "./natalieProposalExecution.js";
import { parseVoiceConfirmationIntent } from "./voiceConfirmation.js";
import { recordVoiceTurnMetric } from "./voiceMetrics.js";
import {
  buildVoiceCancellationSpokenResponse,
  buildVoiceExecutionSpokenResponse,
  buildVoiceSpokenResponse,
} from "./voiceSpokenResponse.js";
import { evaluateVoiceExecutionReadiness } from "./voiceZeroWrongAction.js";
import { processTranscriptAccuracy } from "../../sttAccuracy/index.js";

export type ProcessVoiceTurnInput = {
  organizationId: string;
  userId: string;
  transcript: string;
  sessionId?: string | null;
  legacyHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  role?: string | null;
  permissions?: string[];
};

export type ProcessVoiceTurnResult = ProcessNatalieTurnResult & {
  channel: "web_voice";
  modality: "voice";
  confirmationHandled?: "accepted" | "rejected" | "cancelled" | null;
  executed?: boolean;
  latencyMs: number;
};

export type ProcessVoiceTurnDeps = ProcessNatalieTurnDeps & {
  getSession?: typeof getConversationSession;
  saveSession?: typeof saveConversationSession;
  executeProposal?: typeof executeNataliePendingProposal;
  processTranscriptAccuracyFn?: typeof processTranscriptAccuracy;
};

function buildSttClarificationVoiceResult(input: {
  sessionId?: string | null;
  message: string;
  correlationId: string;
  turnId: string;
  latencyMs: number;
}): ProcessVoiceTurnResult {
  return {
    answer: input.message,
    conversationSessionId: input.sessionId ?? "",
    displayResponse: input.message,
    spokenResponse: input.message,
    confirmation: {
      required: false,
      confirmationType: "none",
      riskLevel: "read_only",
      spokenPrompt: "",
      uiPrompt: "",
      allowed: true,
    },
    zeroWrongAction: { ready: false, violations: ["stt_clarification_required"], followUpQuestion: input.message },
    reliability: {
      correlationId: input.correlationId,
      sessionId: input.sessionId ?? "",
      turnId: input.turnId,
      health: "Degraded",
    },
    channel: "web_voice",
    modality: "voice",
    confirmationHandled: null,
    executed: false,
    latencyMs: input.latencyMs,
  };
}

function applyVoiceSpokenLayer(result: ProcessNatalieTurnResult): ProcessNatalieTurnResult {
  const spokenResponse = buildVoiceSpokenResponse({
    brainResponse: result,
    displayResponse: result.displayResponse,
    confirmation: result.confirmation,
  });
  return {
    ...result,
    spokenResponse,
  };
}

async function handleVoiceConfirmationTurn(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  transcript: string;
  confirmationIntent: "accept" | "reject" | "cancel";
  role?: string | null;
  permissions?: string[];
  deps: ProcessVoiceTurnDeps;
}): Promise<ProcessVoiceTurnResult> {
  const getSession = input.deps.getSession ?? getConversationSession;
  const saveSession = input.deps.saveSession ?? saveConversationSession;
  const executeProposal = input.deps.executeProposal ?? executeNataliePendingProposal;

  const session = await getSession({
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!session) {
    throw new Error("Conversation session not found");
  }

  const trace = createCoreWorkflowTrace({
    subsystem: "natalie_voice",
    organizationId: input.organizationId,
    entityId: session.id,
    explicit: `natalie-conv:${session.id}`,
    workflow: "natalie_voice",
  });
  const turnId = randomUUID();
  emitCoreWorkflowAudit(trace, "started", "voice_confirmation", {
    metadata: { turnId, intent: input.confirmationIntent },
  });

  const userTurn = createConversationTurn({
    role: "user",
    text: input.transcript,
    channel: "web_voice",
  });
  const historyWithUser = appendTurn(session.structuredHistory, userTurn);

  if (input.confirmationIntent === "reject" || input.confirmationIntent === "cancel") {
    const spokenResponse = buildVoiceCancellationSpokenResponse(
      input.confirmationIntent === "cancel" ? "cancelled" : "rejected"
    );
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: spokenResponse,
      channel: "web_voice",
      confirmationState: "rejected",
    });
    const updatedSession = await saveSession({
      ...session,
      currentChannel: "web_voice",
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      pendingAction: null,
      pendingConfirmation: null,
      interruptionState: session.interruptionState,
      lastMessageAt: new Date().toISOString(),
    });
    completeCoreWorkflowStage(trace, "voice_confirmation", "skipped", {
      health: "Healthy",
      metadata: { intent: input.confirmationIntent },
    });
    return {
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
        correlationId: trace.correlationId,
        sessionId: updatedSession.id,
        turnId,
        health: "Healthy",
      },
      channel: "web_voice",
      modality: "voice",
      confirmationHandled: input.confirmationIntent === "cancel" ? "cancelled" : "rejected",
      executed: false,
      latencyMs: 0,
    };
  }

  const readiness = evaluateVoiceExecutionReadiness({
    session,
    pendingConfirmation: session.pendingConfirmation,
    role: input.role,
    permissions: input.permissions,
  });
  if (!readiness.ready || !session.pendingConfirmation) {
    const spokenResponse = readiness.followUpQuestion ?? "לא הצלחתי לאשר את הפעולה.";
    const assistantTurn = createConversationTurn({
      role: "assistant",
      text: spokenResponse,
      channel: "web_voice",
      confirmationState: "pending",
    });
    const updatedSession = await saveSession({
      ...session,
      currentChannel: "web_voice",
      structuredHistory: appendTurn(historyWithUser, assistantTurn),
      lastMessageAt: new Date().toISOString(),
    });
    completeCoreWorkflowStage(trace, "voice_confirmation", "failed", {
      health: "Degraded",
      metadata: { violations: readiness.violations },
    });
    return {
      answer: spokenResponse,
      conversationSessionId: updatedSession.id,
      displayResponse: spokenResponse,
      spokenResponse,
      confirmation: {
        required: true,
        confirmationType: session.pendingConfirmation?.confirmationType ?? "soft",
        riskLevel: "reversible",
        spokenPrompt: session.pendingConfirmation?.spokenPrompt ?? "",
        uiPrompt: session.pendingConfirmation?.uiPrompt ?? "",
        allowed: false,
      },
      zeroWrongAction: readiness,
      reliability: {
        correlationId: trace.correlationId,
        sessionId: updatedSession.id,
        turnId,
        health: "Degraded",
      },
      channel: "web_voice",
      modality: "voice",
      confirmationHandled: null,
      executed: false,
      latencyMs: 0,
    };
  }

  const execution = await executeProposal({
    organizationId: input.organizationId,
    userId: input.userId,
    action: session.pendingConfirmation.action,
    proposal: session.pendingConfirmation.proposal,
  });

  const spokenResponse = execution.ok
    ? buildVoiceExecutionSpokenResponse({
        action: session.pendingConfirmation.action,
        successMessage: execution.message,
      })
    : execution.message;

  const assistantTurn = createConversationTurn({
    role: "assistant",
    text: spokenResponse,
    channel: "web_voice",
    action: session.pendingConfirmation.action,
    proposal: session.pendingConfirmation.proposal,
    confirmationState: execution.ok ? "confirmed" : "rejected",
  });

  const updatedSession = await saveSession({
    ...session,
    currentChannel: "web_voice",
    structuredHistory: appendTurn(historyWithUser, assistantTurn),
    pendingAction: null,
    pendingConfirmation: null,
    interruptionState: session.interruptionState,
    lastMessageAt: new Date().toISOString(),
  });

  completeCoreWorkflowStage(trace, "voice_confirmation", execution.ok ? "completed" : "failed", {
    health: execution.ok ? "Healthy" : "Failed",
    metadata: { action: session.pendingConfirmation.action },
  });

  return {
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
    zeroWrongAction: { ready: execution.ok, violations: execution.ok ? [] : ["execution_failed"] },
    reliability: {
      correlationId: trace.correlationId,
      sessionId: updatedSession.id,
      turnId,
      health: execution.ok ? "Healthy" : "Failed",
    },
    channel: "web_voice",
    modality: "voice",
    confirmationHandled: "accepted",
    executed: execution.ok,
    latencyMs: 0,
  };
}

export async function processVoiceTurn(
  input: ProcessVoiceTurnInput,
  deps: ProcessVoiceTurnDeps = {}
): Promise<ProcessVoiceTurnResult> {
  const startedAt = Date.now();
  const transcript = normalizeChannelInput("web_voice", input.transcript);
  if (!transcript) {
    throw new Error("transcript is required");
  }

  const membership = input.role ? null : await resolveMembershipRole(input.userId, input.organizationId);
  const role = input.role ?? membership?.role ?? null;

  const confirmationIntent = parseVoiceConfirmationIntent(transcript);
  if (input.sessionId && confirmationIntent !== "none") {
    const getSession = deps.getSession ?? getConversationSession;
    const existing = await getSession({
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (existing?.pendingConfirmation) {
      const result = await handleVoiceConfirmationTurn({
        organizationId: input.organizationId,
        userId: input.userId,
        sessionId: input.sessionId,
        transcript,
        confirmationIntent,
        role,
        permissions: input.permissions,
        deps,
      });
      const latencyMs = Date.now() - startedAt;
      recordVoiceTurnMetric({
        sessionId: result.conversationSessionId,
        latencyMs,
        confirmationHandled: result.confirmationHandled ?? null,
        executed: result.executed,
        executionSucceeded: result.executed,
        success: result.reliability.health !== "Failed",
      });
      return { ...result, latencyMs };
    }
  }

  const processAccuracy = deps.processTranscriptAccuracyFn ?? processTranscriptAccuracy;
  const accuracy = await processAccuracy({
    organizationId: input.organizationId,
    rawTranscript: transcript,
    sessionId: input.sessionId,
  });

  if (accuracy.clarificationRequired && accuracy.clarificationMessage) {
    const latencyMs = Date.now() - startedAt;
    const trace = createCoreWorkflowTrace({
      subsystem: "natalie_voice",
      organizationId: input.organizationId,
      entityId: input.sessionId ?? undefined,
      explicit: input.sessionId ? `natalie-conv:${input.sessionId}` : undefined,
      workflow: "natalie_voice",
    });
    const turnId = randomUUID();
    emitCoreWorkflowAudit(trace, "started", "stt_clarification", {
      metadata: {
        confidence: accuracy.confidence,
        actionBlocked: accuracy.actionBlocked,
        correctionsApplied: accuracy.corrections.length,
      },
    });
    completeCoreWorkflowStage(trace, "stt_clarification", "completed", {
      health: "Degraded",
      metadata: { confidence: accuracy.confidence },
    });
    recordVoiceTurnMetric({
      sessionId: input.sessionId ?? "unknown",
      latencyMs,
      success: true,
    });
    return buildSttClarificationVoiceResult({
      sessionId: input.sessionId,
      message: accuracy.clarificationMessage,
      correlationId: trace.correlationId,
      turnId,
      latencyMs,
    });
  }

  const effectiveTranscript = accuracy.normalizedTranscript;

  const trace = createCoreWorkflowTrace({
    subsystem: "natalie_voice",
    organizationId: input.organizationId,
    entityId: input.sessionId ?? undefined,
    explicit: input.sessionId ? `natalie-conv:${input.sessionId}` : undefined,
    workflow: "natalie_voice",
  });
  emitCoreWorkflowAudit(trace, "started", "voice_turn", {
    metadata: { transcriptLength: effectiveTranscript.length, sttConfidence: accuracy.confidence },
  });

  try {
    const turnResult = await processNatalieTurn(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        channel: "web_voice",
        modality: "voice",
        message: effectiveTranscript,
        sessionId: input.sessionId,
        legacyHistory: input.legacyHistory,
        role,
        permissions: input.permissions,
      },
      deps
    );

    const voiced = applyVoiceSpokenLayer(turnResult);
    const latencyMs = Date.now() - startedAt;
    completeCoreWorkflowStage(trace, "voice_turn", "completed", {
      health: voiced.reliability.health,
      metadata: { latencyMs },
    });
    recordVoiceTurnMetric({
      sessionId: voiced.conversationSessionId,
      latencyMs,
      confirmationRequired: voiced.confirmation.required,
      success: true,
    });

    return {
      ...voiced,
      channel: "web_voice",
      modality: "voice",
      confirmationHandled: null,
      executed: false,
      latencyMs,
    };
  } catch (error) {
    emitCoreWorkflowFailure(trace, "voice_turn", error);
    reportCoreWorkflowHealth(trace, "Failed");
    recordVoiceTurnMetric({
      sessionId: input.sessionId ?? "unknown",
      latencyMs: Date.now() - startedAt,
      success: false,
    });
    throw error;
  }
}
