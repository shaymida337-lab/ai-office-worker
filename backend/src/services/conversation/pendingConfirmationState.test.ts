import test from "node:test";
import assert from "node:assert/strict";

import { tryHandleCalendarConfirmationTurn } from "./calendarConfirmationContinuation.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";
import {
  computePendingConfirmationExpiresAt,
  isPendingConfirmationExpired,
  resolveActivePendingConfirmation,
  stampPendingConfirmation,
} from "./pendingConfirmationState.js";

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

test("expired session pending with fresh history pending accepts instead of expiring", async () => {
  const staleCreatedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const freshAt = new Date().toISOString();
  const freshPending = stampPendingConfirmation({
    confirmationId: "conf-fresh-history",
    action: "book_appointment",
    proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
    confirmationType: "soft",
    spokenPrompt: "לאשר?",
    uiPrompt: "לאשר?",
    createdAt: freshAt,
  });
  const session = createPendingSession({
    pendingConfirmation: stampPendingConfirmation({
      confirmationId: "conf-stale",
      action: "book_appointment",
      proposal: { clientName: "ישן", dayReference: "יום שני", time: "09:00" },
      confirmationType: "soft",
      spokenPrompt: "ישן",
      uiPrompt: "ישן",
      createdAt: staleCreatedAt,
    }),
    structuredHistory: [
      {
        id: "turn-user",
        role: "user",
        text: "קבע תור לרון ביום חמישי ב-16",
        channel: "web_chat",
        at: freshAt,
      },
      {
        id: "turn-assistant",
        role: "assistant",
        text: "לאשר?",
        action: "book_appointment",
        proposal: freshPending.proposal,
        confirmationId: freshPending.confirmationId,
        confirmationState: "pending",
        channel: "web_chat",
        at: freshAt,
      },
    ],
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
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-race" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "book_appointment", message: "קבעתי תור לרון" };
      },
    },
  });

  assert.equal(handled.handled, true);
  assert.equal(executeCalls, 1);
  assert.match(handled.result?.answer ?? "", /קבעתי תור לרון/);
});

test("fresh calendar command replaces expired pending without expiry message", async () => {
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

  const handled = await tryHandleCalendarConfirmationTurn({
    session,
    message: "קבע תור לדנה מחר ב-10",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    deps: {
      saveSession: async (next) => next,
    },
  });

  assert.equal(handled.handled, false);
  assert.equal(handled.resetPendingConfirmation, true);
});

test("confirm after 10 seconds still executes", async () => {
  const createdAt = new Date(Date.now() - 10_000).toISOString();
  const session = createPendingSession({
    pendingConfirmation: stampPendingConfirmation({
      confirmationId: "conf-10s",
      action: "book_appointment",
      proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
      createdAt,
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
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-10s" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "book_appointment", message: "בוצע אחרי 10 שניות" };
      },
    },
  });
  assert.equal(executeCalls, 1);
  assert.match(handled.result?.answer ?? "", /בוצע אחרי 10 שניות/);
});

test("confirm after one minute still executes", async () => {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const session = createPendingSession({
    pendingConfirmation: stampPendingConfirmation({
      confirmationId: "conf-1m",
      action: "book_appointment",
      proposal: { clientName: "רון", dayReference: "יום חמישי", time: "16:00" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
      createdAt,
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
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "record-1m" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "book_appointment", message: "בוצע אחרי דקה" };
      },
    },
  });
  assert.equal(executeCalls, 1);
  assert.match(handled.result?.answer ?? "", /בוצע אחרי דקה/);
});

test("isPendingConfirmationExpired uses expiresAt when present", () => {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = computePendingConfirmationExpiresAt(createdAt);
  assert.equal(isPendingConfirmationExpired({ createdAt, expiresAt }, Date.now()), false);
  assert.equal(
    isPendingConfirmationExpired(
      { createdAt, expiresAt: new Date(Date.now() - 1_000).toISOString() },
      Date.now()
    ),
    true
  );
});

test("resolveActivePendingConfirmation prefers fresh session pending", () => {
  const session = createPendingSession();
  const resolved = resolveActivePendingConfirmation({
    session,
    channel: "web_chat",
    role: "owner",
  });
  assert.equal(resolved.source, "session");
  assert.equal(resolved.pending?.confirmationId, "conf-p0-1");
});
