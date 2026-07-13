import test from "node:test";
import assert from "node:assert/strict";
import type { prisma } from "../../lib/prisma.js";
import { addClientNote, findNextAppointmentForClient, listClientNotes } from "./clientCard.js";

/**
 * DB מדומה שמיישם את סמנטיקת ה-where בפועל (org, client, סטטוס, זמן),
 * כדי שהטסטים יוכיחו את הסינון האמיתי — לא רק שהשאילתה "נקראה".
 */
type AppointmentRow = {
  id: string;
  organizationId: string;
  clientId: string;
  status: string;
  startTime: Date;
  durationMinutes: number;
  service: { name: string } | null;
  employee: { name: string } | null;
};

function buildMockDb(appointments: AppointmentRow[]) {
  const createdNotes: Array<Record<string, unknown>> = [];
  const db = {
    appointment: {
      findFirst: async (args: {
        where: {
          organizationId: string;
          clientId: string;
          status: { not: string };
          startTime: { gte: Date };
        };
        orderBy: { startTime: "asc" };
      }) => {
        const matching = appointments
          .filter(
            (row) =>
              row.organizationId === args.where.organizationId &&
              row.clientId === args.where.clientId &&
              row.status !== args.where.status.not &&
              row.startTime.getTime() >= args.where.startTime.gte.getTime()
          )
          .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        return matching[0] ?? null;
      },
    },
    clientNote: {
      create: async (args: { data: Record<string, unknown> }) => {
        const note = { id: `note-${createdNotes.length + 1}`, createdAt: new Date(), ...args.data };
        createdNotes.push(note);
        return note;
      },
      findMany: async (args: { where: { organizationId: string; clientId: string } }) =>
        createdNotes.filter(
          (note) =>
            note.organizationId === args.where.organizationId && note.clientId === args.where.clientId
        ),
    },
  } as unknown as typeof prisma;
  return { db, createdNotes };
}

const NOW = new Date("2026-07-13T12:00:00.000Z");
const base = { organizationId: "org-a", clientId: "client-1" };

test("לקוח עם תור עתידי — מוחזר התור הקרוב ביותר עם שירות ועובד", async () => {
  const { db } = buildMockDb([
    {
      id: "late",
      ...base,
      status: "pending",
      startTime: new Date("2026-07-20T09:00:00.000Z"),
      durationMinutes: 30,
      service: { name: "תספורת" },
      employee: { name: "יוסי" },
    },
    {
      id: "soon",
      ...base,
      status: "confirmed",
      startTime: new Date("2026-07-15T08:00:00.000Z"),
      durationMinutes: 45,
      service: { name: "צבע" },
      employee: { name: "דנה" },
    },
  ]);
  const next = await findNextAppointmentForClient(base, { db, now: NOW });
  assert.ok(next);
  assert.equal(next!.id, "soon", "התור הקרוב ביותר, לא הראשון ברשימה");
  assert.equal(next!.serviceName, "צבע");
  assert.equal(next!.employeeName, "דנה");
});

test("תור מבוטל אינו מוצג כתור הבא", async () => {
  const { db } = buildMockDb([
    {
      id: "cancelled-soon",
      ...base,
      status: "cancelled",
      startTime: new Date("2026-07-14T08:00:00.000Z"),
      durationMinutes: 30,
      service: null,
      employee: null,
    },
    {
      id: "real-next",
      ...base,
      status: "pending",
      startTime: new Date("2026-07-16T08:00:00.000Z"),
      durationMinutes: 30,
      service: null,
      employee: null,
    },
  ]);
  const next = await findNextAppointmentForClient(base, { db, now: NOW });
  assert.equal(next!.id, "real-next");
  assert.equal(next!.serviceName, null, "בלי שירות — null (הפרונט מציג 'לא הוזן')");
});

test("תור שעבר אינו 'תור הבא'; בלי תורים עתידיים — null", async () => {
  const { db } = buildMockDb([
    {
      id: "past",
      ...base,
      status: "confirmed",
      startTime: new Date("2026-07-10T08:00:00.000Z"),
      durationMinutes: 30,
      service: null,
      employee: null,
    },
  ]);
  assert.equal(await findNextAppointmentForClient(base, { db, now: NOW }), null);
});

test("ארגון אחר נחסם — תור של אותו לקוח בארגון אחר לא דולף", async () => {
  const { db } = buildMockDb([
    {
      id: "other-org",
      organizationId: "org-b",
      clientId: "client-1",
      status: "pending",
      startTime: new Date("2026-07-15T08:00:00.000Z"),
      durationMinutes: 30,
      service: null,
      employee: null,
    },
  ]);
  assert.equal(
    await findNextAppointmentForClient({ organizationId: "org-a", clientId: "client-1" }, { db, now: NOW }),
    null,
    "השאילתה תחומה ב-organizationId — לא לפי clientId בלבד"
  );
});

test("הערות: ולידציה, שמירה בהיקף הארגון, וקריאה מסוננת לפי ארגון", async () => {
  const { db } = buildMockDb([]);
  const empty = await addClientNote({ ...base, body: "   " }, { db });
  assert.ok(!empty.ok && empty.error.includes("ריקה"));
  const tooLong = await addClientNote({ ...base, body: "א".repeat(2001) }, { db });
  assert.ok(!tooLong.ok && tooLong.error.includes("ארוכה"));
  const saved = await addClientNote({ ...base, body: " מעדיפה תור בבוקר " }, { db });
  assert.ok(saved.ok);
  assert.equal(saved.ok && (saved.note as { body?: string }).body, "מעדיפה תור בבוקר", "trim");
  assert.equal(saved.ok && (saved.note as { organizationId?: string }).organizationId, "org-a");

  const mine = await listClientNotes(base, { db });
  assert.equal(mine.length, 1);
  const otherOrg = await listClientNotes({ organizationId: "org-b", clientId: "client-1" }, { db });
  assert.equal(otherOrg.length, 0, "ארגון אחר לא רואה את ההערות");
});
