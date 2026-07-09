import test from "node:test";
import assert from "node:assert/strict";

import { askNatalieBusinessQuestion } from "../natalie.js";
import { prisma } from "../../lib/prisma.js";
import { tryHandleCalendarIntentContinuation } from "./conversationCalendarContinuation.js";
import { tryHandleCalendarConfirmationTurn } from "./calendarConfirmationContinuation.js";
import { processNatalieTurn } from "./conversationRuntime.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";
import { calendarPendingAction, type CalendarPendingIntent } from "../calendar/calendarPendingIntent.js";
import { stampPendingConfirmation } from "./pendingConfirmationState.js";
import {
  mergeSlotFillingTurn,
  readCalendarConversationPhase,
  resolveActiveSlotFillingIntent,
  shouldDeferCalendarClarificationToSession,
} from "./calendarConversationState.js";
import { parseCalendarIntent } from "../calendar/calendarIntentParser.js";

function emptySession(overrides?: Partial<ConversationSessionRecord>): ConversationSessionRecord {
  const now = new Date().toISOString();
  return {
    id: "sess-cal-state",
    organizationId: "org-cal-state",
    userId: "user-cal-state",
    currentChannel: "web_chat",
    structuredHistory: [],
    pendingAction: null,
    pendingConfirmation: null,
    interruptionState: null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    ...overrides,
  };
}

function inMemorySessionStore(initial: ConversationSessionRecord) {
  const sessions = new Map<string, ConversationSessionRecord>([[initial.id, initial]]);
  return {
    get: () => sessions.get(initial.id)!,
    save: async (next: ConversationSessionRecord) => {
      sessions.set(next.id, next);
      return next;
    },
    sessions,
  };
}

function installOrgTimezoneMock() {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  return () => {
    prisma.organization.findUnique = originalOrg;
  };
}

test("readCalendarConversationPhase distinguishes idle, slot_filling, awaiting_confirmation", () => {
  const pendingIntent: CalendarPendingIntent = {
    intent: "create_appointment",
    action: "create_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "מחר",
    date: "2026-07-09",
    time: "15:00",
    fromDayReference: null,
    fromTime: null,
    missingFields: ["customerName"],
    originalUserText: "קבעי תור מחר ב-15",
    lastAssistantQuestion: "שם?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  assert.equal(readCalendarConversationPhase(emptySession()), "idle");
  assert.equal(
    readCalendarConversationPhase(emptySession({ pendingAction: calendarPendingAction(pendingIntent) })),
    "slot_filling"
  );
  assert.equal(
    readCalendarConversationPhase(
      emptySession({
        pendingConfirmation: stampPendingConfirmation({
          confirmationId: "c1",
          action: "book_appointment",
          proposal: { clientName: "רון", dayReference: "מחר", time: "15:00" },
          confirmationType: "soft",
          spokenPrompt: "לאשר?",
          uiPrompt: "לאשר?",
        }),
      })
    ),
    "awaiting_confirmation"
  );
});

test("shouldDeferCalendarClarificationToSession catches incomplete create for session persistence", () => {
  const incomplete = parseCalendarIntent("תקבעי לי פגישה ביום חמישי ב 10:00", {
    timeZone: "Asia/Jerusalem",
    now: new Date("2026-07-07T06:00:00.000Z"),
  });
  assert.equal(shouldDeferCalendarClarificationToSession(incomplete), true);

  const complete = parseCalendarIntent("קבעי תור לרונן מחר ב-15:00", {
    timeZone: "Asia/Jerusalem",
  });
  assert.equal(shouldDeferCalendarClarificationToSession(complete), false);
});

test("slot filling: missing name persists pending and name follow-up continues create", async () => {
  const session = emptySession();
  const store = inMemorySessionStore(session);

  const turn1 = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "תקבעי לי פגישה ביום חמישי ב 10:00",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(turn1.handled, true);
  assert.match(turn1.result?.answer ?? "", /שם/);
  assert.equal(turn1.updatedSession?.pendingAction?.action, "calendar_intent_continuation");
  assert.equal(resolveActiveSlotFillingIntent(turn1.updatedSession!)?.intent, "create_appointment");

  const turn2 = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "עם רונן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(turn2.handled, true);
  assert.match(turn2.result?.answer ?? "", /לאשר|רונן/);
  assert.equal(turn2.updatedSession?.pendingConfirmation?.action, "book_appointment");
  assert.equal(turn2.updatedSession?.pendingConfirmation?.proposal.clientName, "רונן");
});

test("slot filling: missing time persists pending and time follow-up continues create", async () => {
  const session = emptySession();
  const store = inMemorySessionStore(session);

  const turn1 = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "תקבעי פגישה עם רונן ביום חמישי",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(turn1.handled, true);
  assert.match(turn1.result?.answer ?? "", /שעה/);
  assert.equal(resolveActiveSlotFillingIntent(turn1.updatedSession!)?.intent, "create_appointment");

  const turn2 = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "בשעה 4",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(turn2.handled, true);
  assert.match(turn2.result?.answer ?? "", /לאשר|16:00/);
  assert.equal(turn2.updatedSession?.pendingConfirmation?.action, "book_appointment");
});

test("intent lock: reschedule slot filling does not flip to create on name follow-up", () => {
  const pending: CalendarPendingIntent = {
    intent: "move_appointment",
    action: "move_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "יום חמישי",
    date: "2026-07-09",
    time: "16:00",
    fromDayReference: null,
    fromTime: null,
    missingFields: ["customerName"],
    originalUserText: "תעבירי את התור ליום חמישי ב-16",
    lastAssistantQuestion: "שם?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeSlotFillingTurn(pending, "דנה");
  assert.equal(merged.kind, "slot_filling");
  assert.equal(merged.intent.intent, "move_appointment");
  assert.equal(merged.intent.customerName, "דנה");
});

test("intent lock: cancel slot filling does not flip to create on name follow-up", () => {
  const pending: CalendarPendingIntent = {
    intent: "cancel_appointment",
    action: "cancel_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "יום חמישי",
    date: "2026-07-09",
    time: null,
    fromDayReference: null,
    fromTime: null,
    missingFields: ["target"],
    originalUserText: "בטלי לי את הפגישות ביום חמישי",
    lastAssistantQuestion: "שם?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeSlotFillingTurn(pending, "את שרית");
  assert.equal(merged.kind, "slot_filling");
  assert.equal(merged.intent.intent, "cancel_appointment");
  assert.equal(merged.intent.customerName, "שרית");
});

test("fresh calendar command replaces stale slot filling without expiry message", async () => {
  const restore = installOrgTimezoneMock();
  try {
    const now = new Date().toISOString();
    const stalePending: CalendarPendingIntent = {
      intent: "create_appointment",
      action: "create_appointment",
      cancelTarget: null,
      customerName: null,
      dayReference: "מחר",
      date: null,
      time: "15:00",
      fromDayReference: null,
      fromTime: null,
      missingFields: ["customerName"],
      originalUserText: "קבעי לי תור מחר ב-15:00",
      lastAssistantQuestion: "שם?",
      createdAt: now,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
    const sessionId = "sess-fresh-replace";
    const store = inMemorySessionStore(
      emptySession({
        id: sessionId,
        pendingAction: calendarPendingAction(stalePending),
      })
    );

    const turn = await processNatalieTurn(
      {
        organizationId: store.get().organizationId,
        userId: store.get().userId,
        channel: "web_chat",
        modality: "text",
        message: "קבעי תור עבור שרון יום שישי ב-15:00",
        sessionId,
        role: "owner",
      },
      {
        resolveSession: async () => store.get(),
        saveSession: store.save,
        ask: async (input) =>
          askNatalieBusinessQuestion({
            organizationId: input.organizationId,
            question: input.question,
            history: input.history,
            conversationContext: input.conversationContext,
          }),
      }
    );

    assert.equal("action" in turn && turn.action, "book_appointment");
    assert.doesNotMatch(turn.answer, /פג תוקף/);
    assert.doesNotMatch(turn.answer, /לא הבנתי למי לקבוע/);
    assert.equal(store.get().pendingConfirmation?.proposal.clientName, "שרון");
  } finally {
    restore();
  }
});

test("create + confirm: slot fill then yes executes without expiry", async () => {
  const session = emptySession();
  const store = inMemorySessionStore(session);

  const turn1 = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "תקבעי לי פגישה ביום חמישי ב 10:00",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(turn1.handled, true);

  const turn2 = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "רונן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(turn2.handled, true);
  assert.ok(turn2.updatedSession?.pendingConfirmation);

  let executeCalls = 0;
  const confirmed = await tryHandleCalendarConfirmationTurn({
    session: store.get(),
    message: "כן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    deps: {
      saveSession: store.save,
      claimConfirmationExecutionFn: async () => ({ mode: "claimed", recordId: "rec-1" }),
      releaseConfirmationExecutionFn: async () => {},
      saveSessionAfterConfirmationExecutionFn: async () => {},
      executePendingProposal: async () => {
        executeCalls += 1;
        return { ok: true, action: "book_appointment", message: "קבעתי תור לרונן." };
      },
    },
  });
  assert.equal(confirmed.handled, true);
  assert.equal(executeCalls, 1);
  assert.doesNotMatch(confirmed.result?.answer ?? "", /פג תוקף/);
  assert.equal(confirmed.updatedSession?.pendingConfirmation, null);
});

test("two appointments in sequence: second create after first confirm clears state", async () => {
  const session = emptySession();
  const store = inMemorySessionStore(session);

  const firstFill = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "תקבעי לי פגישה ביום חמישי ב 10:00",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(firstFill.handled, true);

  const firstComplete = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "רונן",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(firstComplete.handled, true);
  assert.equal(firstComplete.updatedSession?.pendingConfirmation?.proposal.clientName, "רונן");

  const afterFirstConfirm = {
    ...store.get(),
    pendingAction: null,
    pendingConfirmation: null,
    structuredHistory: store.get().structuredHistory,
  };
  store.sessions.set(session.id, afterFirstConfirm);

  const secondFill = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "תקבעי פגישה עם דנה מחר ב-14:00",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });
  assert.equal(secondFill.handled, false);

  const restore = installOrgTimezoneMock();
  try {
    const secondTurn = await processNatalieTurn(
      {
        organizationId: session.organizationId,
        userId: session.userId,
        channel: "web_chat",
        modality: "text",
        message: "תקבעי פגישה עם דנה מחר ב-14:00",
        sessionId: session.id,
        role: "owner",
      },
      {
        resolveSession: async () => store.get(),
        saveSession: store.save,
        ask: async (input) =>
          askNatalieBusinessQuestion({
            organizationId: input.organizationId,
            question: input.question,
            conversationContext: input.conversationContext,
          }),
      }
    );
    assert.equal("action" in secondTurn && secondTurn.action, "book_appointment");
    assert.equal(secondTurn.proposal?.clientName, "דנה");
  } finally {
    restore();
  }
});

test("no double response: incomplete create handled once by continuation without brain clarify", async () => {
  const session = emptySession();
  const store = inMemorySessionStore(session);
  let askCalls = 0;

  const turn = await processNatalieTurn(
    {
      organizationId: session.organizationId,
      userId: session.userId,
      channel: "web_chat",
      modality: "text",
      message: "תקבעי לי פגישה ביום חמישי ב 10:00",
      sessionId: session.id,
      role: "owner",
    },
    {
      resolveSession: async () => store.get(),
      saveSession: store.save,
      ask: async (input) => {
        askCalls += 1;
        return askNatalieBusinessQuestion({
          organizationId: input.organizationId,
          question: input.question,
          conversationContext: input.conversationContext,
        });
      },
    }
  );

  assert.equal(askCalls, 0);
  assert.match(turn.answer, /שם/);
  assert.equal(store.get().pendingAction?.action, "calendar_intent_continuation");
});

test("best available create via continuation returns ranked confirmation not time clarify", async () => {
  const restore = installOrgTimezoneMock();
  try {
    const session = emptySession();
    const store = inMemorySessionStore(session);

    const turn = await processNatalieTurn(
      {
        organizationId: session.organizationId,
        userId: session.userId,
        channel: "web_chat",
        modality: "text",
        message: "תקבעי תור לרון בזמן הכי טוב מחר",
        sessionId: session.id,
        role: "owner",
      },
      {
        resolveSession: async () => store.get(),
        saveSession: store.save,
        ask: async (input) =>
          askNatalieBusinessQuestion({
            organizationId: input.organizationId,
            question: input.question,
            conversationContext: input.conversationContext,
          }),
      }
    );

    assert.equal("action" in turn && turn.action, "book_appointment");
    assert.equal(turn.proposal?.clientName, "רון");
    assert.equal(turn.proposal?.time, "10:30");
    assert.notEqual(turn.proposal?.time, "07:00");
    assert.match(turn.answer, /10:30/);
    assert.match(turn.answer, /לאשר/);
    assert.doesNotMatch(turn.answer, /באיזו שעה לקבוע/);
    assert.equal(store.get().pendingConfirmation?.action, "book_appointment");
    assert.equal(store.get().pendingAction, null);
  } finally {
    restore();
  }
});

test("mergeSlotFillingTurn keeps move intent for customer candidate reply", () => {
  const pending: CalendarPendingIntent = {
    intent: "move_appointment",
    action: "move_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "היום",
    date: "2026-07-09",
    time: "17:00",
    fromDayReference: null,
    fromTime: null,
    missingFields: ["customerName"],
    originalUserText: "תעבירי את הפגישה של רון ל-17:00",
    lastAssistantQuestion: "מצאתי כמה לקוחות...",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    customerCandidates: [
      { id: "c1", name: "רון לוי" },
      { id: "c2", name: "רון כהן" },
    ],
  };
  const merged = mergeSlotFillingTurn(pending, "רון לוי");
  assert.equal(merged.kind, "slot_filling");
  if (merged.kind === "slot_filling") {
    assert.equal(merged.intent.intent, "move_appointment");
    assert.equal(merged.intent.customerName, "רון לוי");
    assert.deepEqual(merged.intent.missingFields, []);
  }
});

test("create without best available still asks for missing time", async () => {
  const session = emptySession();
  const store = inMemorySessionStore(session);

  const turn = await tryHandleCalendarIntentContinuation({
    session: store.get(),
    message: "תקבעי תור לרון מחר",
    channel: "web_chat",
    organizationId: session.organizationId,
    userId: session.userId,
    role: "owner",
    saveSession: store.save,
  });

  assert.equal(turn.handled, true);
  assert.match(turn.result?.answer ?? "", /שעה/);
  assert.doesNotMatch(turn.result?.answer ?? "", /לאשר/);
  assert.equal(store.get().pendingAction?.action, "calendar_intent_continuation");
});
