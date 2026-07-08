import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import { askNatalieBusinessQuestion } from "./natalie.js";

const ORG = "org-calendar-resolution";
const CLIENT_ID = "client-yossi";
const APPOINTMENT_ID = "appt-yossi-tuesday";
const TUESDAY_START = new Date("2026-07-07T12:00:00.000Z");

function disableEngineFlags() {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;
}

function installCalendarResolutionMocks() {
  disableEngineFlags();

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
    const where = args?.where as {
      organizationId?: string;
      clientId?: string;
      status?: { not?: string };
      startTime?: { gte?: Date };
    };
    if (where.organizationId !== ORG) return [];
    if (where.clientId && where.clientId !== CLIENT_ID) return [];
    return [
      {
        id: APPOINTMENT_ID,
        organizationId: ORG,
        clientId: CLIENT_ID,
        serviceId: null,
        startTime: TUESDAY_START,
        durationMinutes: 60,
        status: "confirmed",
        source: "natalie",
        notes: null,
        googleEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        client: { id: CLIENT_ID, name: "יוסי ביטון" },
        service: null,
      },
    ];
  }) as typeof prisma.appointment.findMany;

  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  return () => {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClientFindMany;
    prisma.appointment.findMany = originalAppointmentFindMany;
    prisma.calendarEvent.findMany = originalCalendarEventFindMany;
  };
}

test("fuzzy reschedule resolves גרסי ביטון to יוסי ביטון with confirmation", async () => {
  const restore = installCalendarResolutionMocks();
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תעביר את גרסי ביטון ליום חמישי בשעה שלוש",
    });
    assert.equal("action" in result && result.action, "reschedule_appointment");
    assert.match(result.answer ?? "", /יוסי ביטון/);
    if ("proposal" in result && result.proposal) {
      assert.equal(result.proposal.clientName, "יוסי ביטון");
      assert.equal(result.proposal.appointmentId, APPOINTMENT_ID);
    }
  } finally {
    restore();
  }
});

test("pronoun reschedule uses active calendar context", async () => {
  const restore = installCalendarResolutionMocks();
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תעביר אותו ליום חמישי בשעה שלוש",
      conversationContext: {
        pendingAction: {
          action: "reschedule_appointment",
          proposal: {
            appointmentId: APPOINTMENT_ID,
            clientId: CLIENT_ID,
            clientName: "יוסי ביטון",
          },
        },
      },
    });
    assert.equal("action" in result && result.action, "reschedule_appointment");
    assert.match(result.answer ?? "", /יוסי ביטון/);
  } finally {
    restore();
  }
});

test("advance phrasing (תקדימי ... אותה) resolves via active calendar context", async () => {
  const restore = installCalendarResolutionMocks();
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תקדימי לי אותה ל14:00",
      conversationContext: {
        pendingAction: {
          action: "reschedule_appointment",
          proposal: {
            appointmentId: APPOINTMENT_ID,
            clientId: CLIENT_ID,
            clientName: "יוסי ביטון",
          },
        },
      },
    });
    assert.equal("action" in result && result.action, "reschedule_appointment");
    assert.match(result.answer ?? "", /14:00/);
  } finally {
    restore();
  }
});

test("unrelated low-confidence name asks for clarification instead of wrong update", async () => {
  const restore = installCalendarResolutionMocks();
  try {
    const result = await askNatalieBusinessQuestion({
      organizationId: ORG,
      question: "תעביר את דני כהן ליום חמישי בשעה שלוש",
    });
    assert.equal("action" in result, false);
    assert.match(result.answer ?? "", /לא מצאתי תור|למי התכוונת/);
  } finally {
    restore();
  }
});
