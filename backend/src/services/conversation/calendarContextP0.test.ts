import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  extractCalendarConfirmationRevision,
  isCalendarConfirmationRevisionPhrase,
  reviseCalendarPendingProposal,
} from "./calendarConfirmationRevision.js";
import { tryHandleCalendarConfirmationTurn } from "./calendarConfirmationContinuation.js";
import type { ConversationSessionRecord } from "./conversationTypes.js";
import {
  parseListedAppointmentOrdinalCommand,
  readLastListedAppointments,
  resolveListedAppointmentByOrdinal,
  buildLastListedAppointmentsPendingAction,
  LAST_LISTED_APPOINTMENTS_ACTION,
} from "./lastListedAppointments.js";
import { askNatalieBusinessQuestion } from "../natalie.js";
import { processNatalieTurn } from "./conversationRuntime.js";

function sessionWithBookConfirmation(overrides?: Partial<ConversationSessionRecord>): ConversationSessionRecord {
  const now = new Date().toISOString();
  return {
    id: "sess-confirm-rev",
    organizationId: "org-1",
    userId: "user-1",
    currentChannel: "web_chat",
    structuredHistory: [],
    pendingAction: {
      action: "book_appointment",
      proposal: { clientName: "שרית", dayReference: "מחר", time: "15:00" },
    },
    pendingConfirmation: {
      confirmationId: "conf-1",
      action: "book_appointment",
      proposal: { clientName: "שרית", dayReference: "מחר", time: "15:00" },
      confirmationType: "soft",
      spokenPrompt: "לאשר?",
      uiPrompt: "לאשר?",
      createdAt: now,
    },
    interruptionState: null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    ...overrides,
  };
}

function coerceJsonNull(value: unknown): unknown {
  if (value === null) return null;
  if (value && typeof value === "object" && (value as { name?: string }).name === "JsonNull") {
    return null;
  }
  // Prisma.DbNull / JsonNull are singleton objects — treat empty tagged nulls as null.
  if (value && typeof value === "object" && Object.keys(value as object).length === 0) {
    return null;
  }
  return value;
}

function mockSessionSave() {
  const originalUpdate = prisma.natalieConversationSession.update.bind(prisma.natalieConversationSession);
  prisma.natalieConversationSession.update = (async (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => {
    const data = args.data;
    return {
      id: args.where.id,
      organizationId: "org-1",
      userId: "user-1",
      currentChannel: (data.currentChannel as string) ?? "web_chat",
      structuredHistory: data.structuredHistory ?? [],
      pendingAction: coerceJsonNull(data.pendingAction),
      pendingConfirmation: coerceJsonNull(data.pendingConfirmation),
      interruptionState: coerceJsonNull(data.interruptionState),
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: data.lastMessageAt instanceof Date ? data.lastMessageAt : new Date(),
    };
  }) as typeof prisma.natalieConversationSession.update;
  return () => {
    prisma.natalieConversationSession.update = originalUpdate;
  };
}

test("revision phrases are detected without matching bare לא", () => {
  assert.equal(isCalendarConfirmationRevisionPhrase("לא"), false);
  assert.equal(isCalendarConfirmationRevisionPhrase("כן"), false);
  assert.equal(isCalendarConfirmationRevisionPhrase("לא, בעצם ב-4"), true);
  assert.equal(isCalendarConfirmationRevisionPhrase("לא, ב-10"), true);
  assert.equal(isCalendarConfirmationRevisionPhrase("בעצם מחר"), true);
  assert.equal(isCalendarConfirmationRevisionPhrase("לא מחר, ביום חמישי"), true);
});

test("extractCalendarConfirmationRevision pulls day/time from correction phrases", () => {
  assert.deepEqual(extractCalendarConfirmationRevision("לא, בעצם ב-4"), { time: "16:00" });
  assert.deepEqual(extractCalendarConfirmationRevision("לא, ב-10"), { time: "10:00" });
  assert.deepEqual(extractCalendarConfirmationRevision("בעצם מחר"), { dayReference: "מחר" });
  assert.deepEqual(extractCalendarConfirmationRevision("לא מחר, ביום חמישי"), {
    dayReference: "יום חמישי",
  });
});

test("reviseCalendarPendingProposal rebuilds book confirmation answer", () => {
  const revised = reviseCalendarPendingProposal(
    "book_appointment",
    { clientName: "שרית", dayReference: "מחר", time: "15:00" },
    { time: "16:00" }
  );
  assert.ok("proposal" in revised);
  assert.equal(revised.proposal.time, "16:00");
  assert.equal(revised.proposal.dayReference, "מחר");
  assert.match(revised.answer, /16:00/);
  assert.match(revised.answer, /לאשר/);
});

test("pendingConfirmation revision 'לא, בעצם ב-4' rebuilds proposal instead of accepting", async () => {
  const restore = mockSessionSave();
  try {
    const session = sessionWithBookConfirmation();
    const handled = await tryHandleCalendarConfirmationTurn({
      session,
      message: "לא, בעצם ב-4",
      channel: "web_chat",
      organizationId: "org-1",
      userId: "user-1",
      role: "owner",
    });

    assert.equal(handled.handled, true);
    assert.equal(handled.updatedSession?.pendingConfirmation?.action, "book_appointment");
    assert.equal(handled.updatedSession?.pendingConfirmation?.proposal.time, "16:00");
    assert.equal(handled.updatedSession?.pendingAction?.proposal.time, "16:00");
    assert.match(handled.result?.answer ?? "", /16:00/);
    assert.match(handled.result?.answer ?? "", /לאשר/);
  } finally {
    restore();
  }
});

test("bare לא still rejects pendingConfirmation", async () => {
  const restore = mockSessionSave();
  try {
    const session = sessionWithBookConfirmation();
    const handled = await tryHandleCalendarConfirmationTurn({
      session,
      message: "לא",
      channel: "web_chat",
      organizationId: "org-1",
      userId: "user-1",
      role: "owner",
    });
    assert.equal(handled.handled, true);
    assert.equal(handled.updatedSession?.pendingConfirmation, null);
    assert.equal(handled.updatedSession?.pendingAction, null);
    assert.match(handled.result?.answer ?? "", /לא אבצע/);
  } finally {
    restore();
  }
});

test("list ordinal parser resolves first/second/last commands", () => {
  assert.deepEqual(parseListedAppointmentOrdinalCommand("תבטלי את הראשון"), {
    intent: "cancel_appointment",
    ordinal: { kind: "first" },
  });
  assert.deepEqual(parseListedAppointmentOrdinalCommand("תעבירי את השני"), {
    intent: "reschedule_appointment",
    ordinal: { kind: "index", index: 1 },
  });
  assert.deepEqual(parseListedAppointmentOrdinalCommand("מה האחרון?"), {
    intent: "inspect",
    ordinal: { kind: "last" },
  });
});

test("resolveListedAppointmentByOrdinal maps to concrete items", () => {
  const items = [
    {
      appointmentId: "a1",
      source: "appointment" as const,
      startTime: "2026-07-09T10:00:00.000Z",
      endTime: "2026-07-09T10:30:00.000Z",
      customerName: "שרית",
    },
    {
      appointmentId: "a2",
      source: "appointment" as const,
      startTime: "2026-07-09T12:00:00.000Z",
      endTime: "2026-07-09T12:30:00.000Z",
      customerName: "דני",
    },
  ];
  assert.equal(resolveListedAppointmentByOrdinal(items, { kind: "first" })?.appointmentId, "a1");
  assert.equal(resolveListedAppointmentByOrdinal(items, { kind: "index", index: 1 })?.appointmentId, "a2");
  assert.equal(resolveListedAppointmentByOrdinal(items, { kind: "last" })?.appointmentId, "a2");
});

test("list response stores last_listed_appointments and ordinal cancel uses it", async () => {
  const sessions = new Map<string, ConversationSessionRecord>();
  const now = new Date().toISOString();
  const sessionId = "sess-list-ordinal";
  const listedPending = buildLastListedAppointmentsPendingAction([
    {
      id: "appt-first",
      source: "appointment",
      clientId: "c1",
      clientName: "שרית",
      startTime: new Date("2026-07-09T10:00:00.000Z"),
      durationMinutes: 30,
      status: "confirmed",
    },
    {
      id: "appt-second",
      source: "appointment",
      clientId: "c2",
      clientName: "דני",
      startTime: new Date("2026-07-09T12:00:00.000Z"),
      durationMinutes: 30,
      status: "confirmed",
    },
  ]);

  sessions.set(sessionId, {
    id: sessionId,
    organizationId: "org-list",
    userId: "user-list",
    currentChannel: "web_chat",
    structuredHistory: [
      {
        id: "t1",
        role: "assistant",
        text: "התורים הקרובים שלך:\n• 13:00 — שרית\n• 15:00 — דני",
        action: LAST_LISTED_APPOINTMENTS_ACTION,
        proposal: listedPending!.proposal,
        channel: "web_chat",
        at: now,
      },
    ],
    pendingAction: listedPending,
    pendingConfirmation: null,
    interruptionState: null,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });

  assert.equal(readLastListedAppointments(sessions.get(sessionId)!).length, 2);

  const turn = await processNatalieTurn(
    {
      organizationId: "org-list",
      userId: "user-list",
      channel: "web_chat",
      modality: "text",
      message: "תבטלי את הראשון",
      sessionId,
      role: "owner",
      permissions: ["chat.use", "calendar.cancel", "calendar.create", "calendar.reschedule"],
    },
    {
      resolveSession: async () => sessions.get(sessionId)!,
      saveSession: async (session) => {
        sessions.set(session.id, session);
        return session;
      },
      ask: async (input) =>
        askNatalieBusinessQuestion({
          organizationId: input.organizationId,
          question: input.question,
          conversationContext: input.conversationContext,
        }),
    }
  );

  assert.equal("action" in turn && turn.action, "cancel_appointment");
  if ("action" in turn && turn.action === "cancel_appointment") {
    assert.equal(turn.proposal.appointmentId, "appt-first");
    assert.equal(turn.proposal.clientName, "שרית");
  }
  assert.equal(sessions.get(sessionId)?.pendingConfirmation?.action, "cancel_appointment");
  assert.equal(
    sessions.get(sessionId)?.pendingConfirmation?.proposal.appointmentId,
    "appt-first"
  );
});
