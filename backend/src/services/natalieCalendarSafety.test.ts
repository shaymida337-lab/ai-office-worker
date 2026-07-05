import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import { askNatalieBusinessQuestion } from "./natalie.js";
import { processNatalieTurn } from "./conversation/conversationRuntime.js";
import { executeNataliePendingProposal } from "./conversation/voice/natalieProposalExecution.js";
import { computeAppointmentNameSimilarity } from "./scheduling/calendarAppointmentResolver.js";

const ORG = "org-calendar-safety";
const CLIENT_ID = "client-yossi";
const APPOINTMENT_ID = "appt-yossi-tuesday";
const TUESDAY_START = new Date("2026-07-07T12:00:00.000Z");

function disableEngineFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

function installCalendarMocks(options?: {
  appointments?: Array<{
    id: string;
    clientId: string;
    clientName: string;
    startTime: Date;
  }>;
}) {
  disableEngineFlags();
  const appointments = options?.appointments ?? [
    {
      id: APPOINTMENT_ID,
      clientId: CLIENT_ID,
      clientName: "יוסי ביטון",
      startTime: TUESDAY_START,
    },
  ];

  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalClientFindMany = prisma.client.findMany.bind(prisma.client);
  const originalAppointmentFindMany = prisma.appointment.findMany.bind(prisma.appointment);
  const originalCalendarEventFindMany = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.organization.findUnique = (async () => ({
    timezone: "Asia/Jerusalem",
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;
  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; clientId?: string };
    if (where.organizationId !== ORG) return [];
    const rows = appointments.filter((item) => !where.clientId || item.clientId === where.clientId);
    return rows.map((item) => ({
      id: item.id,
      organizationId: ORG,
      clientId: item.clientId,
      serviceId: null,
      startTime: item.startTime,
      durationMinutes: 60,
      status: "confirmed",
      source: "natalie",
      notes: null,
      googleEventId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: { id: item.clientId, name: item.clientName },
      service: null,
    }));
  }) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  return () => {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClientFindMany;
    prisma.appointment.findMany = originalAppointmentFindMany;
    prisma.calendarEvent.findMany = originalCalendarEventFindMany;
  };
}

test("fuzzy score 0.65-0.85 requires identity confirmation before execution", async () => {
  const spokenName = "רוסי פיטון";
  const score = computeAppointmentNameSimilarity(spokenName, "יוסי ביטון");
  assert.ok(score >= 0.65 && score < 0.85, `expected mid fuzzy score, got ${score}`);

  const restore = installCalendarMocks();
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: `תעביר את ${spokenName} ליום חמישי בשעה שלוש`,
    });
    assert.equal("action" in result && result.action, "reschedule_appointment");
    assert.match(result.answer ?? "", /^התכוונת ל-יוסי ביטון בתאריך .+ בשעה .+\?$/);
    const proposal = "proposal" in result ? (result.proposal as Record<string, unknown>) : null;
    assert.ok(proposal);
    const blocked = await executeNataliePendingProposal({
      organizationId: ORG,
      userId: "user-1",
      action: "reschedule_appointment",
      proposal: proposal!,
    });
    assert.equal(blocked.ok, false);
  } finally {
    restore();
  }
});

test("duplicate similar names require disambiguation", async () => {
  const restore = installCalendarMocks({
    appointments: [
      {
        id: "appt-yossi",
        clientId: "client-yossi",
        clientName: "יוסי ביטון",
        startTime: TUESDAY_START,
      },
      {
        id: "appt-yosef",
        clientId: "client-yosef",
        clientName: "יוסף ביטון",
        startTime: new Date("2026-07-08T12:00:00.000Z"),
      },
    ],
  });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תעביר את גור ביטון ליום חמישי בשעה שלוש",
    });
    assert.equal("action" in result, false);
    assert.match(result.answer ?? "", /מצאתי כמה תורים|למי התכוונת/);
  } finally {
    restore();
  }
});

test("cancel pronoun with stale context does not execute", async () => {
  const restore = installCalendarMocks({ appointments: [] });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תבטל לו",
      conversationContext: {
        pendingAction: {
          action: "cancel_appointment",
          proposal: {
            appointmentId: "missing-appt",
            clientId: CLIENT_ID,
            clientName: "יוסי ביטון",
          },
        },
      },
    });
    assert.equal("action" in result, false);
    assert.match(result.answer ?? "", /לא מצאתי תור פעיל/);
  } finally {
    restore();
  }
});

test("reschedule pronoun with stale context asks clarification", async () => {
  const restore = installCalendarMocks({ appointments: [] });
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תעביר אותו ליום חמישי בשעה שלוש",
      conversationContext: {
        pendingAction: {
          action: "reschedule_appointment",
          proposal: {
            appointmentId: "missing-appt",
            clientId: CLIENT_ID,
            clientName: "יוסי ביטון",
          },
        },
      },
    });
    assert.equal("action" in result, false);
    assert.match(result.answer ?? "", /לא מצאתי תור פעיל|לאיזה תור/);
  } finally {
    restore();
  }
});

test("processNatalieTurn defers fuzzy action to client response", async () => {
  const spokenName = "רוסי פיטון";
  const restore = installCalendarMocks();
  const sessions = new Map<string, unknown>();

  const saveSession = async (session: {
    id: string;
    organizationId: string;
    userId: string;
    structuredHistory: unknown[];
    pendingAction: unknown;
    pendingConfirmation: unknown;
    interruptionState: unknown;
    currentChannel: string;
    lastMessageAt: string;
  }) => {
    sessions.set(session.id, session);
    return session;
  };

  const resolveSession = async () => ({
    id: "session-1",
    organizationId: ORG,
    userId: "user-1",
    currentChannel: "web_chat" as const,
    structuredHistory: [],
    pendingAction: null,
    pendingConfirmation: null,
    interruptionState: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  });

  try {
    const first = await processNatalieTurn(
      {
        organizationId: ORG,
        userId: "user-1",
        channel: "web_chat",
        modality: "text",
        message: `תעביר את ${spokenName} ליום חמישי בשעה שלוש`,
        sessionId: "session-1",
      },
      { resolveSession, saveSession }
    );
    assert.equal("action" in first, false);
    assert.match(first.spokenResponse, /^התכוונת ל-יוסי ביטון בתאריך .+ בשעה .+\?$/);

    const sessionAfterFirst = [...sessions.values()].at(-1) as {
      pendingConfirmation: { proposal: Record<string, unknown> } | null;
    };
    assert.ok(sessionAfterFirst.pendingConfirmation);

    const blocked = await executeNataliePendingProposal({
      organizationId: ORG,
      userId: "user-1",
      action: "reschedule_appointment",
      proposal: sessionAfterFirst.pendingConfirmation!.proposal,
    });
    assert.equal(blocked.ok, false);
  } finally {
    restore();
  }
});
