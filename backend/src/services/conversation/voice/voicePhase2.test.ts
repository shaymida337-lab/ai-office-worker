import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { describe, it, beforeEach } from "node:test";
import { importLegacyHistory } from "../conversationHistory.js";
import type { ConversationSessionRecord } from "../conversationTypes.js";
import { resetCoreDiagnostics, setCoreDiagnosticsEnabled } from "../../reliability/core/index.js";
import { parseVoiceConfirmationIntent } from "./voiceConfirmation.js";
import { buildVoiceSpokenResponse, buildVoiceExecutionSpokenResponse } from "./voiceSpokenResponse.js";
import { getVoiceMetricsSnapshots, recordVoiceTurnMetric, resetVoiceMetrics } from "./voiceMetrics.js";
import { processVoiceTurn } from "./voiceAdapter.js";
import { evaluateVoiceExecutionReadiness } from "./voiceZeroWrongAction.js";

describe("natalie voice phase 2", () => {
  beforeEach(() => {
    resetVoiceMetrics();
    resetCoreDiagnostics();
    setCoreDiagnosticsEnabled(true);
  });

  it("parses spoken confirmation intents", () => {
    assert.equal(parseVoiceConfirmationIntent("כן"), "accept");
    assert.equal(parseVoiceConfirmationIntent("לא"), "reject");
    assert.equal(parseVoiceConfirmationIntent("בטל"), "cancel");
    assert.equal(parseVoiceConfirmationIntent("מה המצב"), "none");
  });

  it("builds natural spoken responses for invoice summaries", () => {
    const spoken = buildVoiceSpokenResponse({
      brainResponse: {
        action: "show_invoice",
        invoices: [
          {
            id: "1",
            supplierName: "חברת החשמל",
            invoiceNumber: "A-1",
            amount: 420,
            currency: "ILS",
            issueDate: "2026-07-01",
            dueDate: null,
            status: "pending",
            driveUrl: null,
          },
        ],
        answer: "מצאתי חשבונית אחת.",
      },
      displayResponse: "מצאתי חשבונית אחת.",
      confirmation: {
        required: false,
        confirmationType: "none",
        riskLevel: "read_only",
        spokenPrompt: "",
        uiPrompt: "",
        allowed: true,
      },
    });
    assert.match(spoken, /מצאתי 1 חשבוניות/);
    assert.match(spoken, /חברת החשמל/);
    assert.match(spoken, /רוצה שאפרט/);
  });

  it("processVoiceTurn routes through processNatalieTurn without executing business logic in adapter", async () => {
    let askCalls = 0;
    const sessions = new Map<string, ConversationSessionRecord>();

    const resolveSession = async (input: {
      sessionId?: string | null;
      organizationId: string;
      userId: string;
      channel: "web_chat" | "web_voice";
      legacyHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    }) => {
      if (input.sessionId && sessions.has(input.sessionId)) return sessions.get(input.sessionId)!;
      const session: ConversationSessionRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        currentChannel: "web_voice",
        structuredHistory: input.legacyHistory ? importLegacyHistory(input.legacyHistory, "web_voice") : [],
        pendingAction: null,
        pendingConfirmation: null,
        interruptionState: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      return session;
    };
    const saveSession = async (session: ConversationSessionRecord) => {
      sessions.set(session.id, session);
      return session;
    };

    const result = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "כמה משימות יש לי?",
        role: "owner",
      },
      {
        ask: async () => {
          askCalls += 1;
          return { answer: "יש לך 3 משימות פתוחות." };
        },
        resolveSession,
        saveSession,
      }
    );

    assert.equal(askCalls, 1);
    assert.equal(result.channel, "web_voice");
    assert.equal(result.modality, "voice");
    assert.match(result.spokenResponse, /3 משימות/);
    assert.ok(result.reliability.correlationId.startsWith("natalie-conv:"));
  });

  it("executes pending proposal on spoken acceptance using shared execution service", async () => {
    const sessionId = randomUUID();
    const session: ConversationSessionRecord = {
      id: sessionId,
      organizationId: "org-1",
      userId: "user-1",
      currentChannel: "web_voice",
      structuredHistory: [],
      pendingAction: {
        action: "create_task",
        proposal: { title: "להתקשר לספק", notes: "" },
      },
      pendingConfirmation: {
        action: "create_task",
        proposal: { title: "להתקשר לספק", notes: "" },
        confirmationType: "soft",
        spokenPrompt: "לאשר?",
        uiPrompt: "לאשר?",
        createdAt: new Date().toISOString(),
      },
      interruptionState: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    };

    const result = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "כן",
        sessionId,
        role: "owner",
      },
      {
        getSession: async () => session,
        saveSession: async (value) => value,
        executeProposal: async () => ({
          ok: true,
          action: "create_task",
          message: 'המשימה "להתקשר לספק" נוצרה.',
        }),
        ask: async () => {
          throw new Error("brain should not be called for spoken confirmation");
        },
      }
    );

    assert.equal(result.confirmationHandled, "accepted");
    assert.equal(result.executed, true);
    assert.match(result.spokenResponse, /בוצע/);
    assert.equal(
      buildVoiceExecutionSpokenResponse({
        action: "create_task",
        successMessage: 'המשימה "להתקשר לספק" נוצרה.',
      }),
      'בוצע. המשימה "להתקשר לספק" נוצרה.'
    );
  });

  it("cancels pending proposal on spoken rejection", async () => {
    const sessionId = randomUUID();
    const session: ConversationSessionRecord = {
      id: sessionId,
      organizationId: "org-1",
      userId: "user-1",
      currentChannel: "web_voice",
      structuredHistory: [],
      pendingAction: { action: "create_task", proposal: { title: "x" } },
      pendingConfirmation: {
        action: "create_task",
        proposal: { title: "x" },
        confirmationType: "soft",
        spokenPrompt: "לאשר?",
        uiPrompt: "לאשר?",
        createdAt: new Date().toISOString(),
      },
      interruptionState: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    };

    const result = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "לא",
        sessionId,
        role: "owner",
      },
      {
        getSession: async () => session,
        saveSession: async (value) => value,
      }
    );

    assert.equal(result.confirmationHandled, "rejected");
    assert.equal(result.executed, false);
    assert.match(result.spokenResponse, /לא אבצע/);
  });

  it("blocks execution when zero-wrong-action validation fails", () => {
    const readiness = evaluateVoiceExecutionReadiness({
      session: {
        id: "s1",
        organizationId: "org-1",
        userId: "user-1",
        currentChannel: "web_voice",
        structuredHistory: [],
        pendingAction: null,
        pendingConfirmation: null,
        interruptionState: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      },
      pendingConfirmation: null,
      role: "owner",
    });
    assert.equal(readiness.ready, false);
    assert.ok(readiness.followUpQuestion);
  });

  it("records voice metrics snapshots", () => {
    recordVoiceTurnMetric({
      sessionId: "s1",
      latencyMs: 120,
      confirmationRequired: true,
      success: true,
    });
    recordVoiceTurnMetric({
      sessionId: "s1",
      latencyMs: 80,
      confirmationHandled: "accepted",
      executed: true,
      executionSucceeded: true,
      success: true,
    });
    const snapshots = getVoiceMetricsSnapshots();
    assert.equal(snapshots.length, 2);
    assert.ok(snapshots[1]!.averageLatencyMs > 0);
  });
});
