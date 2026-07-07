import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import { prisma } from "../lib/prisma.js";
import { processNatalieTurn } from "./conversation/conversationRuntime.js";
import { resolveAppointmentDateTime } from "./appointmentService.js";
import type { ConversationSessionRecord } from "./conversation/conversationTypes.js";
import { executeNataliePendingProposal } from "./conversation/voice/natalieProposalExecution.js";

const ORG = "org-calendar-cancel-cont";
const USER = "user-cancel-cont";
const TZ = "Asia/Jerusalem";

type MockAppointment = {
  id: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
  client: { id: string; name: string };
  service: { name: string } | null;
};

function appointmentOn(
  id: string,
  dayReference: string,
  time: string,
  client: { id: string; name: string }
): MockAppointment {
  const startTime = resolveAppointmentDateTime({ dayReference, time, timeZone: TZ });
  if (!startTime) throw new Error(`could not resolve ${dayReference} ${time}`);
  return { id, startTime, durationMinutes: 30, status: "confirmed", client, service: null };
}

function installMocks(appointments: MockAppointment[]) {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalClient = prisma.client.findMany.bind(prisma.client);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalApptFirst = prisma.appointment.findFirst.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  const originalUpdate = prisma.appointment.update.bind(prisma.appointment);
  const originalTx = prisma.$transaction.bind(prisma);

  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;

  prisma.organization.findUnique = (async () => ({
    timezone: TZ,
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;

  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; clientId?: string };
    if (where.organizationId !== ORG) return [];
    return appointments.filter((a) => !where.clientId || where.clientId === a.client.id);
  }) as typeof prisma.appointment.findMany;

  prisma.appointment.findFirst = (async (args) => {
    const where = args?.where as { id?: string; organizationId?: string };
    if (where.organizationId !== ORG) return null;
    const appt = appointments.find((a) => a.id === where.id);
    return appt ? { ...appt, client: appt.client, service: appt.service } : null;
  }) as typeof prisma.appointment.findFirst;

  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  prisma.appointment.update = (async (args) => {
    const id = (args as { where: { id: string } }).where.id;
    const appt = appointments.find((a) => a.id === id);
    if (!appt) throw new Error("not found");
    if ((args as { data: { status?: string } }).data.status) {
      appt.status = (args as { data: { status: string } }).data.status;
    }
    return appt as never;
  }) as typeof prisma.appointment.update;

  prisma.$transaction = (async (arg) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    const tx = {
      appointment: {
        findFirst: prisma.appointment.findFirst,
        update: prisma.appointment.update,
      },
      $executeRaw: async () => 1,
    };
    return arg(tx as never);
  }) as typeof prisma.$transaction;

  return () => {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClient;
    prisma.appointment.findMany = originalAppt;
    prisma.appointment.findFirst = originalApptFirst;
    prisma.calendarEvent.findMany = originalEvent;
    prisma.appointment.update = originalUpdate;
    prisma.$transaction = originalTx;
  };
}

function createSessionStore() {
  const sessions = new Map<string, ConversationSessionRecord>();
  return {
    sessions,
    async resolveSession(input: {
      sessionId?: string | null;
      organizationId: string;
      userId: string;
      channel: ConversationSessionRecord["currentChannel"];
    }) {
      if (input.sessionId && sessions.has(input.sessionId)) {
        return sessions.get(input.sessionId)!;
      }
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
    },
    async saveSession(session: ConversationSessionRecord) {
      sessions.set(session.id, session);
      return session;
    },
  };
}

test("A: day-only cancel then את כולם asks confirmation for all Thursday appointments", async () => {
  const restore = installMocks([
    appointmentOn("a1", "יום חמישי", "10:00", { id: "c1", name: "שרית" }),
    appointmentOn("a2", "יום חמישי", "12:00", { id: "c2", name: "דנה" }),
    appointmentOn("a3", "יום חמישי", "15:00", { id: "c3", name: "אור" }),
  ]);
  const store = createSessionStore();
  try {
    const turn1 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "בטלי לי את הפגישות ביום חמישי",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.match(turn1.answer ?? "", /לא הבנתי למי לבטל/);

    const turn2 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "את כולם ביום חמישי",
        sessionId: turn1.conversationSessionId,
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.equal("action" in turn2 && turn2.action, "cancel_appointments");
    assert.match(turn2.answer ?? "", /מצאתי 3 פגישות/);
    assert.match(turn2.answer ?? "", /לבטל את כולן/);
  } finally {
    restore();
  }
});

test("B: בטלי את כל התורים מחר asks confirmation without customer name", async () => {
  const restore = installMocks([
    appointmentOn("b1", "מחר", "10:00", { id: "c1", name: "שרית" }),
  ]);
  const store = createSessionStore();
  try {
    const turn = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "בטלי את כל התורים מחר",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.equal("action" in turn && turn.action, "cancel_appointments");
    assert.match(turn.answer ?? "", /לבטל את כולן/);
  } finally {
    restore();
  }
});

test("G: zero appointments on Thursday returns checked-calendar empty message", async () => {
  const restore = installMocks([
    appointmentOn("g1", "מחרתיים", "10:00", { id: "c1", name: "שרית" }),
  ]);
  const store = createSessionStore();
  try {
    const turn1 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "בטלי לי את הפגישות ביום חמישי",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    const turn2 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "את כולם ביום חמישי",
        sessionId: turn1.conversationSessionId,
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.match(turn2.answer ?? "", /בדקתי את היומן שלך ולא מצאתי פגישות ביום חמישי/);
  } finally {
    restore();
  }
});

test("E: כן after cancel-all confirmation cancels exactly those appointments", async () => {
  const appointments = [
    appointmentOn("e1", "יום חמישי", "10:00", { id: "c1", name: "שרית" }),
    appointmentOn("e2", "יום חמישי", "12:00", { id: "c2", name: "דנה" }),
    appointmentOn("e3", "יום חמישי", "15:00", { id: "c3", name: "אור" }),
  ];
  const restore = installMocks(appointments);
  const store = createSessionStore();
  try {
    const turn1 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "בטלי את כל התורים ביום חמישי",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    const turn2 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "כן",
        sessionId: turn1.conversationSessionId,
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.match(turn2.answer ?? "", /ביטלתי 3 פגישות/);
    assert.equal(appointments.every((a) => a.status === "cancelled"), true);
  } finally {
    restore();
  }
});

test("F: bare כן without pending confirmation does not cancel", async () => {
  const appointments = [appointmentOn("f1", "מחר", "10:00", { id: "c1", name: "שרית" })];
  const restore = installMocks(appointments);
  const store = createSessionStore();
  try {
    const turn = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "כן",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.match(turn.answer ?? "", /לא הבנתי למה התכוונת/);
    assert.equal(appointments[0]?.status, "confirmed");
  } finally {
    restore();
  }
});

test("CREATE complete: 'תקבעי לי פגישה עם רונן ביום חמישי ב 10:00 בבוקר' proposes booking, no name question", async () => {
  const restore = installMocks([]);
  const store = createSessionStore();
  try {
    const turn = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "תקבעי לי פגישה עם רונן ביום חמישי ב 10:00 בבוקר",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.equal("action" in turn && turn.action, "book_appointment");
    assert.doesNotMatch(turn.answer ?? "", /מה שם הלקוח/);
    assert.match(turn.answer ?? "", /רונן/);
    assert.match(turn.answer ?? "", /10:00/);
  } finally {
    restore();
  }
});

test("CREATE follow-up: missing customer then 'עם רונן' merges and proposes booking", async () => {
  const restore = installMocks([]);
  const store = createSessionStore();
  try {
    const turn1 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "תקבעי לי פגישה ביום חמישי ב 10:00",
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.match(turn1.answer ?? "", /מה שם הלקוח/);

    const turn2 = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: USER,
        channel: "web_chat",
        modality: "text",
        message: "עם רונן",
        sessionId: turn1.conversationSessionId,
        role: "owner",
      },
      { resolveSession: store.resolveSession, saveSession: store.saveSession }
    );
    assert.equal("action" in turn2 && turn2.action, "book_appointment");
    assert.match(turn2.answer ?? "", /רונן/);
    assert.match(turn2.answer ?? "", /10:00/);
  } finally {
    restore();
  }
});

test("batch cancel execution clears only targeted IDs", async () => {
  const appointments = [
    appointmentOn("e1", "יום חמישי", "10:00", { id: "c1", name: "שרית" }),
    appointmentOn("e2", "יום חמישי", "12:00", { id: "c2", name: "דנה" }),
    appointmentOn("e3", "יום חמישי", "15:00", { id: "c3", name: "אור" }),
  ];
  const restore = installMocks(appointments);
  try {
    const result = await executeNataliePendingProposal({
      organizationId: ORG,
      userId: USER,
      action: "cancel_appointments",
      proposal: {
        appointmentIds: ["e1", "e2", "e3"],
        cancelTarget: "all",
        appointmentResolution: {
          source: "exact",
          matchScore: 1,
          spokenName: "כולם",
          matchedName: "כולם",
          fuzzyIdentityConfirmationPending: false,
          identityConfirmed: true,
        },
      },
    });
    assert.equal(result.ok, true);
    assert.match(result.message, /3 פגישות/);
    assert.equal(appointments.every((a) => a.status === "cancelled"), true);
  } finally {
    restore();
  }
});
