import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { describe, it } from "node:test";
import { importLegacyHistory } from "./conversationHistory.js";
import { processNatalieTurn } from "./conversationRuntime.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";
import { processVoiceTurn } from "./voice/voiceAdapter.js";
import { tryHandleAvailabilityContinuation } from "./conversationAvailabilityContinuation.js";

const sampleSlots = [
  {
    startTime: "2026-07-06T07:00:00.000Z",
    endTime: "2026-07-06T08:00:00.000Z",
    label: "מחר 10:00",
    durationMinutes: 60,
  },
  {
    startTime: "2026-07-06T09:30:00.000Z",
    endTime: "2026-07-06T10:30:00.000Z",
    label: "מחר 12:30",
    durationMinutes: 60,
  },
  {
    startTime: "2026-07-06T13:00:00.000Z",
    endTime: "2026-07-06T14:00:00.000Z",
    label: "מחר 16:00",
    durationMinutes: 60,
  },
];

function sessionWithAvailability(clientName?: string): ConversationSessionRecord {
  return {
    id: randomUUID(),
    organizationId: "org-1",
    userId: "user-1",
    currentChannel: "web_voice",
    structuredHistory: [],
    pendingAction: {
      action: "suggest_available_times",
      proposal: {
        slots: sampleSlots,
        durationMinutes: 60,
        dayReference: "מחר",
        clientName,
        intent: "suggest",
        refreshParams: { dayReference: "מחר", durationMinutes: 60, limit: 3 },
      },
    },
    pendingConfirmation: null,
    interruptionState: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  };
}

describe("conversation availability continuation", () => {
  it("resolves slot and builds book confirmation with customer from context", () => {
    const session = sessionWithAvailability("דוד כהן");
    const handled = tryHandleAvailabilityContinuation({
      session,
      message: "12:30",
      channel: "web_voice",
      role: "owner",
    });
    assert.equal(handled.handled, true);
    assert.ok(handled.result);
    assert.equal(handled.updatedSession?.pendingConfirmation?.action, "book_appointment");
    assert.equal(handled.updatedSession?.pendingConfirmation?.proposal.clientName, "דוד כהן");
    assert.match(handled.result!.answer, /דוד כהן/);
    assert.match(handled.result!.answer, /12:30/);
    assert.match(handled.result!.answer, /לקבוע/);
  });

  it("asks for client name when slot is chosen without customer context", () => {
    const session = sessionWithAvailability();
    const handled = tryHandleAvailabilityContinuation({
      session,
      message: "השני",
      channel: "web_chat",
      role: "owner",
    });
    assert.equal(handled.handled, true);
    assert.match(handled.result!.answer, /למי לקבוע/);
    assert.equal(handled.updatedSession?.pendingAction?.action, "availability_continuation");
  });

  it("completes booking after client name follow-up", () => {
    let session = sessionWithAvailability();
    const slotPick = tryHandleAvailabilityContinuation({
      session,
      message: "בעשר",
      channel: "web_voice",
      role: "owner",
    });
    session = slotPick.updatedSession!;
    const namePick = tryHandleAvailabilityContinuation({
      session,
      message: "דוד כהן",
      channel: "web_voice",
      role: "owner",
    });
    assert.equal(namePick.handled, true);
    assert.equal(namePick.updatedSession?.pendingConfirmation?.action, "book_appointment");
    assert.equal(namePick.updatedSession?.pendingConfirmation?.proposal.clientName, "דוד כהן");
  });

  it("cancels availability flow on spoken rejection", () => {
    const session = sessionWithAvailability("דוד כהן");
    const handled = tryHandleAvailabilityContinuation({
      session,
      message: "לא",
      channel: "web_voice",
      role: "owner",
    });
    assert.equal(handled.handled, true);
    assert.equal(handled.updatedSession?.pendingAction, null);
    assert.match(handled.result!.answer, /לא נקבע/);
  });

  it("processNatalieTurn routes slot selection without calling the brain", async () => {
    const sessions = new Map<string, ConversationSessionRecord>();
    const base = sessionWithAvailability("דוד כהן");
    sessions.set(base.id, base);

    let askCalls = 0;
    const result = await processNatalieTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        channel: "web_voice",
        message: "12:30",
        sessionId: base.id,
        role: "owner",
      },
      {
        ask: async () => {
          askCalls += 1;
          return { answer: "should not run" };
        },
        resolveSession: async (input) => sessions.get(input.sessionId!) ?? base,
        saveSession: async (session) => {
          sessions.set(session.id, session);
          return session;
        },
      }
    );

    assert.equal(askCalls, 0);
    assert.equal("action" in result && result.action, "book_appointment");
    assert.match(result.answer, /דוד כהן/);
    assert.equal(result.confirmation.required, true);
  });

  it("processVoiceTurn executes booking after slot pick and spoken confirmation", async () => {
    const sessionId = randomUUID();
    const session = sessionWithAvailability("דוד כהן");
    session.id = sessionId;

    let executeCalls = 0;
    const sessions = new Map<string, ConversationSessionRecord>([[sessionId, session]]);

    const slotResult = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "12:30",
        sessionId,
        role: "owner",
      },
      {
        ask: async () => ({ answer: "unused" }),
        resolveSession: async (input) => {
          if (input.sessionId && sessions.has(input.sessionId)) return sessions.get(input.sessionId)!;
          return session;
        },
        saveSession: async (value) => {
          sessions.set(value.id, value);
          return value;
        },
        getSession: async (input) => sessions.get(input.sessionId) ?? null,
        processTranscriptAccuracyFn: async ({ rawTranscript }) => ({
          normalizedTranscript: rawTranscript,
          confidence: 1,
          clarificationRequired: false,
          actionBlocked: false,
          corrections: [],
        }),
      }
    );

    assert.equal("action" in slotResult && slotResult.action, "book_appointment");
    assert.equal(slotResult.confirmation.required, true);

    const confirmResult = await processVoiceTurn(
      {
        organizationId: "org-1",
        userId: "user-1",
        transcript: "כן בבקשה",
        sessionId,
        role: "owner",
      },
      {
        getSession: async (input) => sessions.get(input.sessionId) ?? null,
        saveSession: async (value) => {
          sessions.set(value.id, value);
          return value;
        },
        executeProposal: async () => {
          executeCalls += 1;
          return { ok: true, action: "book_appointment", message: "התור נקבע." };
        },
        ask: async () => {
          throw new Error("brain should not run on confirmation");
        },
      }
    );

    assert.equal(executeCalls, 1);
    assert.equal(confirmResult.executed, true);
    assert.match(confirmResult.spokenResponse, /התור נקבע/);
  });
});
