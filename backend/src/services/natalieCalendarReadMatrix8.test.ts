/**
 * Eight-case Natalie calendar read-only matrix.
 * Runs through askNatalieBusinessQuestion (deterministic path, no Claude).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../lib/prisma.js";
import { askNatalieBusinessQuestion } from "./natalie.js";
import { resolveAppointmentDateTime } from "./appointmentService.js";

const ORG = "org-natalie-read-8";
const TZ = "Asia/Jerusalem";
const NOW = new Date("2026-07-07T06:00:00.000Z"); // Tue → היום; מחר = Wed

type MockAppt = {
  id: string;
  startTime: Date;
  durationMinutes: number;
  status: string;
  client: { id: string; name: string };
  service: { name: string } | null;
};

function appt(
  id: string,
  dayReference: string,
  time: string,
  client: { id: string; name: string }
): MockAppt {
  const startTime = resolveAppointmentDateTime({
    dayReference,
    time,
    timeZone: TZ,
    now: NOW,
  });
  if (!startTime) throw new Error(`resolve failed ${dayReference} ${time}`);
  return { id, startTime, durationMinutes: 30, status: "confirmed", client, service: { name: "תספורת" } };
}

function installMocks(input: {
  appointments: MockAppt[];
  clients?: Array<{ id: string; name: string }>;
  unconfirmedIds?: string[];
}) {
  delete process.env.CALENDAR_ENGINE_V1_READ;
  delete process.env.CALENDAR_ENGINE_V1_WRITE;

  const clients = input.clients ?? [];
  const originalOrg = prisma.organization.findUnique.bind(prisma.organization);
  const originalClient = prisma.client.findMany.bind(prisma.client);
  const originalClientFindFirst = prisma.client.findFirst.bind(prisma.client);
  const originalAppt = prisma.appointment.findMany.bind(prisma.appointment);
  const originalEvent = prisma.calendarEvent.findMany.bind(prisma.calendarEvent);
  const originalIntegration = prisma.integration.findUnique.bind(prisma.integration);
  const originalProjection = prisma.appointmentAttendanceProjection.findMany.bind(
    prisma.appointmentAttendanceProjection
  );

  prisma.organization.findUnique = (async () => ({
    timezone: TZ,
    calendarEngineReadEnabled: false,
    calendarEngineWriteEnabled: false,
    calendarEngineGoogleMirrorEnabled: false,
  })) as typeof prisma.organization.findUnique;

  prisma.client.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; name?: { contains?: string; mode?: string } | string };
    if (where?.organizationId && where.organizationId !== ORG) return [];
    let rows = clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: null,
      whatsappNumber: null,
      emailIsPlaceholder: true,
      isActive: true,
      organizationId: ORG,
    }));
    const nameFilter = where?.name;
    if (nameFilter && typeof nameFilter === "object" && typeof nameFilter.contains === "string") {
      const needle = nameFilter.contains.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(needle));
    }
    return rows;
  }) as typeof prisma.client.findMany;

  prisma.client.findFirst = (async (args) => {
    const where = args?.where as { id?: string; organizationId?: string };
    const hit = clients.find(
      (c) => c.id === where?.id && (!where.organizationId || where.organizationId === ORG)
    );
    return hit
      ? {
          id: hit.id,
          name: hit.name,
          email: null,
          whatsappNumber: null,
          emailIsPlaceholder: true,
        }
      : null;
  }) as typeof prisma.client.findFirst;

  prisma.appointment.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string; clientId?: string };
    if (where.organizationId !== ORG) return [];
    return input.appointments.filter((a) => !where.clientId || where.clientId === a.client.id);
  }) as typeof prisma.appointment.findMany;

  prisma.calendarEvent.findMany = (async () => []) as typeof prisma.calendarEvent.findMany;
  prisma.integration.findUnique = (async () => null) as typeof prisma.integration.findUnique;

  prisma.appointmentAttendanceProjection.findMany = (async (args) => {
    const where = args?.where as { organizationId?: string };
    if (where?.organizationId && where.organizationId !== ORG) return [];
    return (input.unconfirmedIds ?? []).map((appointmentId) => ({
      appointmentId,
      organizationId: ORG,
      confirmationStatus: "no_response",
      attendanceState: "no_response",
    }));
  }) as typeof prisma.appointmentAttendanceProjection.findMany;

  return () => {
    prisma.organization.findUnique = originalOrg;
    prisma.client.findMany = originalClient;
    prisma.client.findFirst = originalClientFindFirst;
    prisma.appointment.findMany = originalAppt;
    prisma.calendarEvent.findMany = originalEvent;
    prisma.integration.findUnique = originalIntegration;
    prisma.appointmentAttendanceProjection.findMany = originalProjection;
  };
}

const throwingClaude = {
  now: NOW,
  loadTimezone: async () => TZ,
  askClaude: async () => {
    throw new Error("Claude must not be called for deterministic calendar reads");
  },
};

test("Natalie calendar read-only: 8-case matrix with actual answers", async () => {
  const restore = installMocks({
    clients: [
      { id: "c-dana", name: "דנה יהודה שלם" },
      { id: "c-dani1", name: "דני כהן" },
      { id: "c-dani2", name: "דני לוי" },
      { id: "c-sarit", name: "שרית" },
    ],
    appointments: [
      appt("today-1", "היום", "10:00", { id: "c-sarit", name: "שרית" }),
      appt("tom-dana", "מחר", "11:00", { id: "c-dana", name: "דנה יהודה שלם" }),
      appt("tom-dani1", "מחר", "14:00", { id: "c-dani1", name: "דני כהן" }),
      appt("later-dani2", "מחרתיים", "09:00", { id: "c-dani2", name: "דני לוי" }),
    ],
    unconfirmedIds: ["tom-dana"],
  });

  const report: Array<{ label: string; question: string; answer: string; pass: boolean }> = [];

  try {
    const cases: Array<{
      label: string;
      question: string;
      assert: (answer: string) => void;
    }> = [
      {
        label: "היום",
        question: "מה יש לי היום ביומן?",
        assert: (a) => {
          assert.match(a, /שרית/);
          assert.doesNotMatch(a, /דנה יהודה שלם/);
        },
      },
      {
        label: "מחר",
        question: "מה יש לי מחר?",
        assert: (a) => {
          assert.match(a, /דנה יהודה שלם/);
          assert.match(a, /דני כהן/);
          assert.doesNotMatch(a, /שרית/);
        },
      },
      {
        label: "לקוח לפי שם",
        question: "מה התורים של דנה יהודה שלם?",
        assert: (a) => {
          assert.match(a, /דנה יהודה שלם/);
          assert.doesNotMatch(a, /דני כהן/);
        },
      },
      {
        label: "התור הבא",
        question: "מה התור הבא שלי?",
        assert: (a) => {
          assert.match(a, /הפגישה הבאה|התור הבא|שרית/);
          assert.match(a, /שרית/);
        },
      },
      {
        label: "לא אישרו הגעה",
        question: "מי לא אישר הגעה?",
        assert: (a) => {
          assert.match(a, /דנה יהודה שלם/);
          assert.doesNotMatch(a, /דני כהן/);
        },
      },
      {
        label: "זמן פנוי",
        question: "מתי אני פנוי מחר?",
        assert: (a) => {
          assert.match(a, /מצאתי \d+ זמנים פנויים/);
          assert.doesNotMatch(a, /11:00/);
          // Chronological: first listed time should be earliest of the three.
          const times = [...a.matchAll(/(\d{1,2}:\d{2})/g)].map((m) => m[1]!);
          assert.ok(times.length >= 3);
          const toMinutes = (t: string) => {
            const [h, m] = t.split(":").map(Number);
            return h! * 60 + m!;
          };
          const sample = times.slice(0, 3).map(toMinutes);
          assert.deepEqual(sample, [...sample].sort((a, b) => a - b));
        },
      },
      {
        label: "אין תוצאה",
        question: "מה יש לי ביום ראשון בעוד שבועיים?",
        assert: (a) => {
          assert.match(a, /אין|לא מצא|איני יכולה/u);
        },
      },
      {
        label: "שם כפול",
        question: "מה התורים של דני?",
        assert: (a) => {
          assert.match(a, /למי התכוונת/);
          assert.match(a, /דני כהן/);
          assert.match(a, /דני לוי/);
        },
      },
    ];

    for (const c of cases) {
      const res = await askNatalieBusinessQuestion(
        { organizationId: ORG, question: c.question },
        throwingClaude
      );
      const answer = res.answer ?? "";
      let pass = true;
      try {
        c.assert(answer);
      } catch {
        pass = false;
      }
      report.push({ label: c.label, question: c.question, answer, pass });
      c.assert(answer);
    }
  } finally {
    restore();
    console.log("\n=== NATALIE READ-ONLY 8-CASE REPORT ===");
    for (const row of report) {
      console.log(`\n[${row.pass ? "PASS" : "FAIL"}] ${row.label}`);
      console.log(`Q: ${row.question}`);
      console.log(`A: ${row.answer.slice(0, 500)}`);
    }
    console.log("\n=== END REPORT ===\n");
  }
});
