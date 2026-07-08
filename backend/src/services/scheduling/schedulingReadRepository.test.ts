import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma.js";
import {
  getUpcomingSchedulingForClient,
  getUpcomingSchedulingForOrganization,
} from "./schedulingReadRepository.js";

const ORG = "org-read-repo";
const OTHER_ORG = "org-read-repo-other";
const CLIENT_A = "client-a";
const CLIENT_B = "client-b";

const APPT_START = new Date("2026-08-01T09:00:00.000Z");
const EVENT_START = new Date("2026-08-01T07:00:00.000Z");
const EVENT_END = new Date("2026-08-01T07:30:00.000Z");

function installMocks() {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  const originalIntegration = prisma.integration.findUnique.bind(prisma.integration);

  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; clientId?: string };
    if (where.organizationId !== ORG) return [];
    if (where.clientId && where.clientId !== CLIENT_A) return [];
    return [
      {
        id: "appt-1",
        startTime: APPT_START,
        durationMinutes: 60,
        status: "confirmed",
        googleEventId: null,
        client: { id: CLIENT_A, name: "שרית לוי", email: null, whatsappNumber: null },
        service: { name: "תספורת" },
      },
    ];
  }) as typeof prisma.appointment.findMany;

  prisma.calendarEvent.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; clientId?: string };
    if (where.organizationId !== ORG) return [];
    if (where.clientId && where.clientId !== CLIENT_B) return [];
    return [
      {
        id: "event-1",
        startAt: EVENT_START,
        endAt: EVENT_END,
        status: "confirmed",
        title: null,
        googleEventId: null,
        client: { id: CLIENT_B, name: "דני כהן", email: null, whatsappNumber: null },
        service: { name: "ייעוץ", durationMinutes: 30 },
      },
    ];
  }) as typeof prisma.calendarEvent.findMany;

  // No Google Calendar connection for baseline isolation tests.
  prisma.integration.findUnique = (async () => null) as typeof prisma.integration.findUnique;

  return () => {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
    prisma.integration.findUnique = originalIntegration;
  };
}

test("org read merges Appointment + CalendarEvent, sorted by start time", async () => {
  const restore = installMocks();
  try {
    const items = await getUpcomingSchedulingForOrganization({ organizationId: ORG });
    assert.equal(items.length, 2);
    // Event (07:00) is earlier than the appointment (09:00) → sorted first.
    assert.equal(items[0]!.id, "event-1");
    assert.equal(items[0]!.source, "calendar_event");
    assert.equal(items[1]!.id, "appt-1");
    assert.equal(items[1]!.source, "appointment");
  } finally {
    restore();
  }
});

test("appointment-table booking is discoverable", async () => {
  const restore = installMocks();
  try {
    const items = await getUpcomingSchedulingForOrganization({ organizationId: ORG });
    const appt = items.find((item) => item.source === "appointment");
    assert.ok(appt);
    assert.equal(appt!.clientName, "שרית לוי");
    assert.equal(appt!.serviceName, "תספורת");
    assert.equal(appt!.clientId, CLIENT_A);
  } finally {
    restore();
  }
});

test("calendar-event booking is discoverable with derived duration", async () => {
  const restore = installMocks();
  try {
    const items = await getUpcomingSchedulingForOrganization({ organizationId: ORG });
    const event = items.find((item) => item.source === "calendar_event");
    assert.ok(event);
    assert.equal(event!.clientName, "דני כהן");
    assert.equal(event!.durationMinutes, 30);
  } finally {
    restore();
  }
});

test("organization isolation: another org sees nothing", async () => {
  const restore = installMocks();
  try {
    const items = await getUpcomingSchedulingForOrganization({ organizationId: OTHER_ORG });
    assert.equal(items.length, 0);
  } finally {
    restore();
  }
});

test("client read is scoped to the client across both tables", async () => {
  const restore = installMocks();
  try {
    const forA = await getUpcomingSchedulingForClient({ organizationId: ORG, clientId: CLIENT_A });
    assert.equal(forA.length, 1);
    assert.equal(forA[0]!.source, "appointment");

    const forB = await getUpcomingSchedulingForClient({ organizationId: ORG, clientId: CLIENT_B });
    assert.equal(forB.length, 1);
    assert.equal(forB[0]!.source, "calendar_event");
  } finally {
    restore();
  }
});

test("cross-table duplicate appears once preferring calendar_event", async () => {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  const originalIntegration = prisma.integration.findUnique.bind(prisma.integration);

  const start = new Date("2026-08-02T12:00:00.000Z");
  prisma.appointment.findMany = (async () => [
    {
      id: "appt-dup",
      startTime: start,
      durationMinutes: 45,
      status: "confirmed",
      googleEventId: "same-g",
      client: { id: CLIENT_A, name: "שרית לוי", email: null, whatsappNumber: "0501111111" },
      service: { name: "תספורת" },
    },
  ]) as typeof prisma.appointment.findMany;

  prisma.calendarEvent.findMany = (async () => [
    {
      id: "event-dup",
      startAt: start,
      endAt: new Date(start.getTime() + 45 * 60_000),
      status: "confirmed",
      title: null,
      googleEventId: "same-g",
      client: { id: CLIENT_A, name: "שרית לוי", email: null, whatsappNumber: "0501111111" },
      service: { name: "תספורת", durationMinutes: 45 },
    },
  ]) as typeof prisma.calendarEvent.findMany;
  prisma.integration.findUnique = (async () => null) as typeof prisma.integration.findUnique;

  try {
    const items = await getUpcomingSchedulingForOrganization({
      organizationId: ORG,
      skipGoogle: true,
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, "event-dup");
    assert.equal(items[0]!.source, "calendar_event");
  } finally {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
    prisma.integration.findUnique = originalIntegration;
  }
});

test("Google-only event appears in upcoming scheduling list", async () => {
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);

  prisma.appointment.findMany = (async () => []) as typeof prisma.appointment.findMany;
  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;

  try {
    const items = await getUpcomingSchedulingForOrganization({
      organizationId: ORG,
      now: new Date("2026-08-01T00:00:00.000Z"),
      googleItems: [
        {
          id: "gcal:ext-1",
          source: "google_calendar",
          clientId: null,
          clientName: "פגישה חיצונית",
          startTime: new Date("2026-08-01T16:00:00.000Z"),
          durationMinutes: 60,
          status: "confirmed",
          googleEventId: "ext-1",
        },
      ],
    });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.source, "google_calendar");
    assert.equal(items[0]!.clientName, "פגישה חיצונית");
  } finally {
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
  }
});
