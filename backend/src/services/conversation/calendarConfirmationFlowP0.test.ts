import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import { tryHandleCalendarConfirmationTurn } from "./calendarConfirmationContinuation.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";
import { stampPendingConfirmation } from "./pendingConfirmationState.js";

function createPendingSession(overrides?: Partial<ConversationSessionRecord>): ConversationSessionRecord {
  const now = new Date().toISOString();
  const pending = stampPendingConfirmation({
    confirmationId: "conf-p0-1",
    action: "book_appointment",
    proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
    confirmationType: "soft",
    spokenPrompt: "לאשר?",
    uiPrompt: "לאשר?",
    createdAt: now,
  });
  return {
    id: "sess-p0-confirm",
    organizationId: "org-1",
    userId: "user-1",
    currentChannel: "web_chat",
    structuredHistory: [],
    pendingAction: {
      action: "book_appointment",
      proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
    },
    pendingConfirmation: pending,
    interruptionState: null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    ...overrides,
  };
}

test("confirmation -> yes executes pending action and clears pending state", async () => {
  const session = createPendingSession();
  let executeCalls = 0;

  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "כן",
    channel: "web_chat",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      claimConfirmationExecutionFn: async () => ({
        mode: "claimed",
        recordId: "record-1",
      }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => {
        executeCalls += 1;
        return {
          ok: true,
          action: "book_appointment",
          message: "מעולה. קבעתי תור לרון ביום חמישי בשעה 16:00.",
        };
      },
    },
  });

  assert.equal(handled.handled, true);
  assert.equal(executeCalls, 1);
  assert.equal(handled.updatedSession?.pendingConfirmation, null);
  assert.equal(handled.updatedSession?.pendingAction, null);
  assert.match(handled.result?.answer ?? "", /קבעתי תור לרון/);
});

test("confirmation -> no cancels pending action", async () => {
  const session = createPendingSession();
  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "לא",
    channel: "web_chat",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    deps: {
      saveSession: async (next) => next,
    },
  });
  assert.equal(handled.handled, true);
  assert.equal(handled.updatedSession?.pendingConfirmation, null);
  assert.equal(handled.updatedSession?.pendingAction, null);
  assert.match(handled.result?.answer ?? "", /לא אבצע|ביטלתי/);
});

test("confirmation -> yes handles execution errors without empty response and keeps pending", async () => {
  const session = createPendingSession();
  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "כן",
    channel: "web_chat",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-err" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => {
        throw new Error("השעה הזו כבר תפוסה, אפשר לבחור זמן אחר");
      },
    },
  });
  assert.equal(handled.handled, true);
  assert.equal(handled.updatedSession?.pendingConfirmation?.action, "book_appointment");
  assert.equal(handled.updatedSession?.pendingAction?.action, "book_appointment");
  assert.equal((handled.result?.answer ?? "").length > 0, true);
  assert.match(handled.result?.answer ?? "", /השעה הזו כבר תפוסה|לא הצלחתי לבצע/);
});

test("confirmation -> correction updates pending proposal and keeps confirmation", async () => {
  const session = createPendingSession();
  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "לא, ביום שישי",
    channel: "web_chat",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    deps: {
      saveSession: async (next) => next,
    },
  });
  assert.equal(handled.handled, true);
  assert.equal(handled.updatedSession?.pendingConfirmation?.action, "book_appointment");
  assert.equal(handled.updatedSession?.pendingConfirmation?.proposal.dayReference, "יום שישי");
  assert.match(handled.result?.answer ?? "", /לאשר/);
});

test("correction -> yes executes corrected pending action", async () => {
  const session = createPendingSession();
  const corrected = await tryHandleCalendarConfirmationTurn({
    session,
    message: "לא, ביום שישי",
    channel: "web_chat",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    deps: {
      saveSession: async (next) => next,
    },
  });
  assert.equal(corrected.handled, true);
  const correctedSession = corrected.updatedSession!;
  assert.equal(correctedSession.pendingConfirmation?.proposal.dayReference, "יום שישי");

  let executeCalls = 0;
  const confirmed = await tryHandleCalendarConfirmationTurn({
    session: correctedSession,
    message: "כן בבקשה",
    channel: "web_chat",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-2" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async ({ proposal }) => {
        executeCalls += 1;
        return {
          ok: true,
          action: "book_appointment",
          message: `בוצע עבור ${String(proposal.dayReference ?? "")}`,
        };
      },
    },
  });
  assert.equal(confirmed.handled, true);
  assert.equal(executeCalls, 1);
  assert.match(confirmed.result?.answer ?? "", /יום שישי/);
});

test("multiple confirmations in same conversation remain isolated", async () => {
  let session = createPendingSession();
  const first = await tryHandleCalendarConfirmationTurn({
    session,
    message: "כן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-3" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => ({ ok: true, action: "book_appointment", message: "בוצע 1" }),
    },
  });
  assert.equal(first.handled, true);
  session = {
    ...first.updatedSession!,
    pendingAction: {
      action: "book_appointment",
      proposal: { clientName: "נועם", dayReference: "יום שני", time: "10:00" },
    },
    pendingConfirmation: stampPendingConfirmation({
      confirmationId: randomUUID(),
      action: "book_appointment",
      proposal: { clientName: "נועם", dayReference: "יום שני", time: "10:00" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
    }),
  };
  const second = await tryHandleCalendarConfirmationTurn({
    session,
    message: "לא",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    deps: {
      saveSession: async (next) => next,
    },
  });
  assert.equal(second.handled, true);
  assert.equal(second.updatedSession?.pendingConfirmation, null);
});

test("pending expiration clears stale pending confirmation after timeout", async () => {
  const staleCreatedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const session = createPendingSession({
    pendingConfirmation: stampPendingConfirmation({
      confirmationId: "conf-stale",
      action: "book_appointment",
      proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
      createdAt: staleCreatedAt,
    }),
  });
  let executeCalls = 0;
  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "כן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      executePendingProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "book_appointment", message: "should not execute" };
      },
    },
  });
  assert.equal(handled.handled, true);
  assert.equal(executeCalls, 0);
  assert.equal(handled.updatedSession?.pendingConfirmation, null);
  assert.match(handled.result?.answer ?? "", /פג תוקף/);
});

test("restart safety: loaded session with pending confirmation still routes yes to confirmation handler", async () => {
  const loaded = createPendingSession({
    id: "sess-restart",
    structuredHistory: [
      {
        id: "turn-a1",
        role: "assistant",
        text: 'שמעתי: "לקבוע תור לרון ביום חמישי בשעה 16:00." זה נכון?',
        channel: "web_chat",
        confirmationState: "pending",
        at: new Date().toISOString(),
      },
    ],
  });
  const handled = await tryHandleCalendarConfirmationTurn({
    session: loaded,
    message: "נכון",
    channel: "web_chat",
    organizationId: loaded.organizationId,
    userId: loaded.userId,
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-restart" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => ({ ok: true, action: "book_appointment", message: "בוצע אחרי טעינה" }),
    },
  });
  assert.equal(handled.handled, true);
  assert.match(handled.result?.answer ?? "", /בוצע אחרי טעינה/);
});

test("no duplicate execution when claim returns replay", async () => {
  const session = createPendingSession();
  let executeCalls = 0;
  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "כן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    deps: {
      saveSession: async (next) => next,
      claimConfirmationExecutionFn: async () => ({
        mode: "replay",
        duplicateTurn: true,
        record: {
          status: "completed",
          ok: true,
          resultMessage: "כבר ביצעתי את הפעולה הזו.",
        },
      }),
      executePendingProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "book_appointment", message: "should not happen" };
      },
    },
  });
  assert.equal(handled.handled, true);
  assert.equal(executeCalls, 0);
  assert.match(handled.result?.answer ?? "", /כבר ביצעתי/);
});
