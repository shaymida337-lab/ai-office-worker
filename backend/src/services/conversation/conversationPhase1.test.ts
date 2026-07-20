import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { describe, it, beforeEach } from "node:test";
import { getChannelAdapter, normalizeChannelInput } from "./conversationAdapters.js";
import { evaluateConfirmationPolicy } from "./conversationConfirmationPolicy.js";
import {
  appendTurn,
  createConversationTurn,
  importLegacyHistory,
  toBrainHistory,
} from "./conversationHistory.js";
import { getConversationMetrics, recordConversationMetric, resetConversationMetrics } from "./conversationMetrics.js";
import { processNatalieTurn } from "./conversationRuntime.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";
import { evaluateZeroWrongAction } from "./conversationZeroWrongAction.js";
import {
  getCoreDiagnosticEvents,
  resetCoreDiagnostics,
  setCoreDiagnosticsEnabled,
} from "../reliability/core/index.js";

describe("natalie conversation platform phase 1", () => {
  beforeEach(() => {
    resetConversationMetrics();
    resetCoreDiagnostics();
    setCoreDiagnosticsEnabled(true);
  });

  it("stores structured history with action and proposal", () => {
    const turn = createConversationTurn({
      role: "assistant",
      text: "ליצור משימה?",
      channel: "web_chat",
      action: "create_task",
      proposal: { title: "להתקשר לספק" },
      confirmationState: "pending",
    });
    assert.equal(turn.action, "create_task");
    assert.equal(turn.proposal?.title, "להתקשר לספק");
    assert.equal(turn.confirmationState, "pending");
  });

  it("imports legacy text history into structured turns", () => {
    const turns = importLegacyHistory(
      [
        { role: "user", content: "שלום" },
        { role: "assistant", content: "שלום! איך אפשר לעזור?" },
      ],
      "web_chat"
    );
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.role, "user");
    assert.equal(turns[1]?.channel, "web_chat");
  });

  it("converts structured history to brain history", () => {
    const turns = importLegacyHistory([{ role: "user", content: "כמה משימות יש לי?" }], "web_chat");
    const brainHistory = toBrainHistory(turns);
    assert.deepEqual(brainHistory, [{ role: "user", content: "כמה משימות יש לי?" }]);
  });

  it("evaluates confirmation policy consistently for financial actions", () => {
    const policy = evaluateConfirmationPolicy({
      action: "issue_invoice",
      channel: "web_chat",
      role: "employee",
    });
    assert.equal(policy.required, true);
    assert.equal(policy.confirmationType, "hard");
    assert.equal(policy.riskLevel, "financial");
    assert.match(policy.uiPrompt, /לאשר/);
  });

  it("blocks zero-wrong-action when proposal is incomplete", () => {
    const confirmation = evaluateConfirmationPolicy({
      action: "create_task",
      channel: "web_chat",
      role: "employee",
    });
    const readiness = evaluateZeroWrongAction({
      action: "create_task",
      proposal: {},
      confirmation,
      intentText: "צור משימה",
    });
    assert.equal(readiness.ready, false);
    assert.ok(readiness.followUpQuestion);
  });

  it("normalizes channel input through adapter abstraction", () => {
    const adapter = getChannelAdapter("web_voice");
    assert.equal(normalizeChannelInput("web_voice", "  שלום   נטלי  "), "שלום נטלי");
    assert.equal(adapter.channel, "web_voice");
  });

  it("processNatalieTurn uses runtime, session store, and reliability metadata", async () => {
    const sessions = new Map<string, ConversationSessionRecord>();

    async function resolveSession(input: {
      sessionId?: string | null;
      organizationId: string;
      userId: string;
      channel: "web_chat";
      legacyHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    }) {
      if (input.sessionId && sessions.has(input.sessionId)) {
        return sessions.get(input.sessionId)!;
      }
      const session: ConversationSessionRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        currentChannel: input.channel,
        structuredHistory: input.legacyHistory
          ? importLegacyHistory(input.legacyHistory, input.channel)
          : [],
        pendingAction: null,
        pendingConfirmation: null,
        interruptionState: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      return session;
    }

    async function saveSession(session: ConversationSessionRecord) {
      sessions.set(session.id, session);
      return session;
    }

    const result = await processNatalieTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        channel: "web_chat",
        modality: "text",
        message: "שלום",
        role: "owner",
      },
      {
        ask: async () => ({ answer: "שלום! איך אפשר לעזור?" }),
        resolveSession,
        saveSession,
      }
    );

    assert.equal(result.answer, "שלום! איך אפשר לעזור?");
    assert.ok(result.conversationSessionId);
    assert.ok(result.reliability.correlationId.startsWith("natalie-conv:"));
    assert.equal(result.displayResponse, result.answer);
    const saved = sessions.get(result.conversationSessionId);
    assert.equal(saved?.structuredHistory.length, 2);
    assert.ok(getCoreDiagnosticEvents().some((event) => event.kind === "workflow:completed"));
    recordConversationMetric({
      sessionId: result.conversationSessionId,
      channel: "web_chat",
      turnCount: 2,
      confirmationRequired: false,
      recoveryCount: 0,
      interruptionCount: 0,
      durationMs: 10,
      success: true,
    });
    assert.equal(getConversationMetrics().length, 2);
  });

  it("sanitizes final api answer for מי הלקוח הבא שלי when calendar is empty", async () => {
    const sessions = new Map<string, ConversationSessionRecord>();
    const resolveSession = async (input: {
      sessionId?: string | null;
      organizationId: string;
      userId: string;
      channel: "web_chat";
    }) => {
      if (input.sessionId && sessions.has(input.sessionId)) return sessions.get(input.sessionId)!;
      const session: ConversationSessionRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        currentChannel: input.channel,
        structuredHistory: [],
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

    const result = await processNatalieTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        channel: "web_chat",
        modality: "text",
        message: "מי הלקוח הבא שלי?",
        role: "owner",
      },
      {
        ask: async () => ({
          answer: "אין לך פגישות קרובות ביומן.\n\nמקור נתונים: Google Calendar אומת בהצלחה (תמונה מלאה).",
        }),
        resolveSession,
        saveSession,
      }
    );

    assert.equal(result.answer, "בדקתי את היומן שלך. אין לך פגישות מתוכננות כרגע.");
    assert.equal(result.displayResponse, result.answer);
    assert.doesNotMatch(result.answer, /Google Calendar|מקור נתונים|תמונה מלאה|אומת בהצלחה/i);
  });

  it("preserves session across turns via session id", async () => {
    const sessions = new Map<string, ConversationSessionRecord>();
    const resolveSession = async (input: {
      sessionId?: string | null;
      organizationId: string;
      userId: string;
      channel: "web_chat";
    }) => {
      if (input.sessionId && sessions.has(input.sessionId)) return sessions.get(input.sessionId)!;
      const session: ConversationSessionRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        currentChannel: input.channel,
        structuredHistory: [],
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
    const ask = async (input: { history?: Array<{ role: string; content: string }> }) => ({
      answer: `history=${input.history?.length ?? 0}`,
    });

    const first = await processNatalieTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        channel: "web_chat",
        modality: "text",
        message: "שלום",
        role: "owner",
      },
      { ask, resolveSession, saveSession }
    );
    const second = await processNatalieTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        channel: "web_chat",
        modality: "text",
        message: "עוד שאלה",
        sessionId: first.conversationSessionId,
        role: "owner",
      },
      { ask, resolveSession, saveSession }
    );

    assert.equal(second.answer, "history=3");
    assert.equal(first.conversationSessionId, second.conversationSessionId);
    const saved = sessions.get(first.conversationSessionId);
    assert.equal(saved?.structuredHistory.length, 4);
    assert.equal(appendTurn(saved!.structuredHistory, saved!.structuredHistory[0]!).length, 5);
  });
});
