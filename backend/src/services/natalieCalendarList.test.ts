import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import { askNatalieBusinessQuestion } from "./natalie.js";
import { resolveAppointmentDateTime } from "./appointmentService.js";

const ORG = "org-calendar-list";
const TZ = "Asia/Jerusalem";
const CLIENT_SARIT = "client-sarit";
const CLIENT_DANI = "client-dani";

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

/** Mock both tables + timezone. Appointments live in the legacy Appointment table. */
function installMocks(appointments: MockAppointment[]) {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalClient = prisma.client.findMany.bind(prisma.client);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

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

  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  return () => {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClient;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  };
}

const throwingClaude = {
  loadTimezone: async () => TZ,
  askClaude: async () => {
    throw new Error("Claude must not be called for deterministic calendar reads");
  },
};

test('list: "מה יש לי מחר ביומן?" returns tomorrow appointments only, no Claude', async () => {
  const restore = installMocks([
    appointmentOn("appt-tomorrow", "מחר", "15:00", { id: CLIENT_SARIT, name: "שרית" }),
    appointmentOn("appt-dayafter", "מחרתיים", "16:00", { id: CLIENT_DANI, name: "דני" }),
  ]);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "מה יש לי מחר ביומן?" },
      throwingClaude
    );
    assert.ok(!("action" in res));
    assert.match(res.answer ?? "", /שרית/);
    assert.doesNotMatch(res.answer ?? "", /דני/);
  } finally {
    restore();
  }
});

test('list: "מה התורים שלי?" returns all upcoming appointments', async () => {
  const restore = installMocks([
    appointmentOn("appt-tomorrow", "מחר", "15:00", { id: CLIENT_SARIT, name: "שרית" }),
    appointmentOn("appt-dayafter", "מחרתיים", "16:00", { id: CLIENT_DANI, name: "דני" }),
  ]);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "מה התורים שלי?" },
      throwingClaude
    );
    assert.ok(!("action" in res));
    assert.match(res.answer ?? "", /שרית/);
    assert.match(res.answer ?? "", /דני/);
  } finally {
    restore();
  }
});

test('list: empty day answers clearly', async () => {
  const restore = installMocks([
    appointmentOn("appt-tomorrow", "מחר", "15:00", { id: CLIENT_SARIT, name: "שרית" }),
  ]);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "מה יש לי מחרתיים ביומן?" },
      throwingClaude
    );
    assert.ok(!("action" in res));
    assert.match(res.answer ?? "", /אין לך תורים/);
  } finally {
    restore();
  }
});

test("cancel with day filter targets only the matching day", async () => {
  const restore = installMocks([
    appointmentOn("appt-tomorrow", "מחר", "15:00", { id: CLIENT_SARIT, name: "שרית" }),
    appointmentOn("appt-dayafter", "מחרתיים", "16:00", { id: CLIENT_SARIT, name: "שרית" }),
  ]);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תבטלי את התור של שרית מחר" },
      throwingClaude
    );
    assert.equal("action" in res && res.action, "cancel_appointment");
    if ("proposal" in res && res.proposal) {
      assert.equal(res.proposal.appointmentId, "appt-tomorrow");
    }
    // Not the multi-appointment "which one?" prompt.
    assert.doesNotMatch(res.answer ?? "", /איזה תור/);
  } finally {
    restore();
  }
});

test("move with day filter targets only the matching day", async () => {
  const restore = installMocks([
    appointmentOn("appt-monday", "יום שני", "15:00", { id: CLIENT_SARIT, name: "שרית" }),
    appointmentOn("appt-wednesday", "יום רביעי", "15:00", { id: CLIENT_SARIT, name: "שרית" }),
  ]);
  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "תעבירי את התור של שרית ביום שני לשלוש" },
      throwingClaude
    );
    assert.equal("action" in res && res.action, "reschedule_appointment");
    if ("proposal" in res && res.proposal) {
      assert.equal(res.proposal.appointmentId, "appt-monday");
    }
    assert.doesNotMatch(res.answer ?? "", /איזה תור/);
  } finally {
    restore();
  }
});

test("CalendarEvent-stored booking is discoverable by Natalie's list", async () => {
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalClient = prisma.client.findMany.bind(prisma.client);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  const start = resolveAppointmentDateTime({ dayReference: "מחר", time: "15:00", timeZone: TZ })!;

  prisma.organization.findUnique = (async () => ({ timezone: TZ })) as typeof prisma.organization.findUnique;
  prisma.client.findMany = (async () => []) as typeof prisma.client.findMany;
  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string };
    if (where.organizationId !== ORG) return [];
    return [
      {
        id: "event-1",
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        status: "confirmed",
        title: null,
        client: { id: "client-event", name: "מירי" },
        service: { name: "טיפול", durationMinutes: 30 },
      },
    ];
  }) as typeof prisma.calendarEvent.findMany;

  try {
    const res = await askNatalieBusinessQuestion(
      { organizationId: ORG, question: "מה יש לי מחר ביומן?" },
      throwingClaude
    );
    assert.ok(!("action" in res));
    assert.match(res.answer ?? "", /מירי/);
  } finally {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClient;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});
