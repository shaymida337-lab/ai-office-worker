import test from "node:test";
import assert from "node:assert/strict";

import { parseCalendarIntent } from "./calendarIntentParser.js";
import {
  filterAppointmentsForReadRange,
  runCalendarReadEngine,
  type CalendarReadEngineDeps,
  type CalendarReadQuery,
} from "./calendarReadEngine.js";
import type { UpcomingSchedulingOrgResult } from "../scheduling/schedulingFacade.js";

const NOW = new Date("2026-07-07T06:00:00.000Z");
const TZ = "Asia/Jerusalem";
const ORG = "org-read-engine";

function item(
  id: string,
  startIso: string,
  clientName: string,
  clientId = "c1",
  durationMinutes = 60
) {
  return {
    id,
    startTime: new Date(startIso),
    durationMinutes,
    clientName,
    serviceName: "תספורת",
    clientId,
    source: "appointment" as const,
  };
}

function mockDetailed(
  items: ReturnType<typeof item>[],
  googleReadStatus: UpcomingSchedulingOrgResult["googleReadStatus"] = "full"
): UpcomingSchedulingOrgResult {
  return {
    items,
    googleReadStatus,
    googleReadDegraded: false,
  };
}

async function runQuery(
  question: string,
  items: ReturnType<typeof item>[],
  overrides?: Partial<CalendarReadQuery>,
  deps?: Pick<CalendarReadEngineDeps, "searchCustomers" | "loadUnconfirmedAppointmentIds">
) {
  const intent = parseCalendarIntent(question, { now: NOW, timeZone: TZ });
  assert.equal(intent.intent, "list_appointments");
  return runCalendarReadEngine({
    organizationId: ORG,
    query: {
      rangeType: intent.rangeType,
      dayReference: intent.dayReference,
      readMode: intent.readMode ?? "list",
      nextFocus: intent.nextFocus,
      customerName: intent.customerName,
      ...overrides,
    },
    timeZone: TZ,
    now: NOW,
    deps: {
      loadDetailed: async () => mockDetailed(items),
      searchCustomers: deps?.searchCustomers ?? (async () => []),
      loadUnconfirmedAppointmentIds: deps?.loadUnconfirmedAppointmentIds,
    },
  });
}

test('parser: "מה הפגישה הבאה שלי?" → next / appointment', () => {
  const result = parseCalendarIntent("מה הפגישה הבאה שלי?", { now: NOW, timeZone: TZ });
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.readMode, "next");
  assert.equal(result.nextFocus, "appointment");
});

test('parser: "מי הלקוח הבא?" → next / client', () => {
  const result = parseCalendarIntent("מי הלקוח הבא?", { now: NOW, timeZone: TZ });
  assert.equal(result.readMode, "next");
  assert.equal(result.nextFocus, "client");
});

test('parser: "כמה פגישות יש לי מחר?" → count / day / מחר', () => {
  const result = parseCalendarIntent("כמה פגישות יש לי מחר?", { now: NOW, timeZone: TZ });
  assert.equal(result.readMode, "count");
  assert.equal(result.dayReference, "מחר");
  assert.equal(result.rangeType, "day");
});

test('read engine: next appointment returns earliest upcoming', async () => {
  const items = [
    item("a1", "2026-07-08T07:00:00.000Z", "שרית"),
    item("a2", "2026-07-08T12:00:00.000Z", "דני"),
  ];
  const result = await runQuery("מה הפגישה הבאה שלי?", items);
  assert.match(result.answer, /שרית/);
  assert.match(result.answer, /הפגישה הבאה/);
  assert.equal(result.action, "last_listed_appointments");
});

test('read engine: tomorrow list with friendly empty message', async () => {
  const result = await runQuery("מה יש לי מחר?", []);
  assert.match(result.answer, /אין לך פגישות מתוכננות למחר/);
  assert.doesNotMatch(result.answer, /^אין\.$/);
});

test('read engine: week list returns chronological entries', async () => {
  const items = [
    item("late", "2026-07-10T10:00:00.000Z", "דני"),
    item("early", "2026-07-08T07:00:00.000Z", "שרית"),
    item("mid", "2026-07-09T08:00:00.000Z", "רון"),
  ];
  const result = await runQuery("מה יש לי השבוע?", items);
  const shritIndex = result.answer.indexOf("שרית");
  const ronIndex = result.answer.indexOf("רון");
  const dannyIndex = result.answer.indexOf("דני");
  assert.ok(shritIndex >= 0 && ronIndex >= 0 && dannyIndex >= 0);
  assert.ok(shritIndex < ronIndex);
  assert.ok(ronIndex < dannyIndex);
});

test('read engine: count tomorrow', async () => {
  const items = [
    item("a1", "2026-07-08T07:00:00.000Z", "שרית"),
    item("a2", "2026-07-08T12:00:00.000Z", "דני"),
  ];
  const result = await runQuery("כמה פגישות יש לי מחר?", items);
  assert.match(result.answer, /2 פגישות/);
});

test('read engine: count clients today uses unique clients', async () => {
  const items = [
    item("a1", "2026-07-07T08:00:00.000Z", "שרית", "c1"),
    item("a2", "2026-07-07T12:00:00.000Z", "שרית", "c1"),
    item("a3", "2026-07-07T14:00:00.000Z", "דני", "c2"),
  ];
  const result = await runQuery("כמה לקוחות יש לי היום?", items);
  assert.match(result.answer, /2 לקוחות/);
});

test("filterAppointmentsForReadRange keeps week window through Saturday", () => {
  const items = [
    item("in-week", "2026-07-10T10:00:00.000Z", "שרית"),
    item("next-week", "2026-07-13T10:00:00.000Z", "דני"),
  ];
  const filtered = filterAppointmentsForReadRange(items, {
    rangeType: "week",
    dayReference: null,
    timeZone: TZ,
    now: NOW,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.clientName, "שרית");
});

test("read engine: Google + local merge path uses detailed loader unchanged", async () => {
  const googleItem = {
    ...item("g1", "2026-07-08T09:00:00.000Z", "Google Client", "g-client"),
    source: "google_calendar" as const,
  };
  let loaderCalls = 0;
  const result = await runCalendarReadEngine({
    organizationId: ORG,
    query: { readMode: "list", rangeType: "day", dayReference: "מחר" },
    timeZone: TZ,
    now: NOW,
    deps: {
      loadDetailed: async (params) => {
        loaderCalls += 1;
        assert.equal(params.organizationId, ORG);
        assert.ok(params.now);
        return mockDetailed([googleItem], "full");
      },
      searchCustomers: async () => [],
    },
  });
  assert.equal(loaderCalls, 1);
  assert.match(result.answer, /Google Client/);
  assert.match(result.answer, /Google Calendar אומת/);
});

test('parser: "מה התורים של דנה?" keeps customer name', () => {
  const result = parseCalendarIntent("מה התורים של דנה?", { now: NOW, timeZone: TZ });
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.customerName, "דנה");
  assert.equal(result.readMode, "list");
});

test('parser: "מי לא אישר הגעה?" → unconfirmed_arrival', () => {
  const result = parseCalendarIntent("מי לא אישר הגעה?", { now: NOW, timeZone: TZ });
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.readMode, "unconfirmed_arrival");
});

test("read engine: list by unique customer name", async () => {
  const items = [
    item("a1", "2026-07-08T07:00:00.000Z", "דנה יהודה שלם", "c-dana"),
    item("a2", "2026-07-08T12:00:00.000Z", "דני כהן", "c-dani"),
  ];
  const result = await runQuery("מה התורים של דנה יהודה שלם?", items, undefined, {
    searchCustomers: async () => [
      {
        id: "c-dana",
        name: "דנה יהודה שלם",
        email: null,
        whatsappNumber: null,
        emailIsPlaceholder: true,
      },
    ],
  });
  assert.match(result.answer, /דנה יהודה שלם/);
  assert.doesNotMatch(result.answer, /דני כהן/);
});

test("read engine: duplicate name asks which client", async () => {
  const items = [
    item("a1", "2026-07-08T07:00:00.000Z", "דני כהן", "c-dani1"),
    item("a2", "2026-07-09T07:00:00.000Z", "דני לוי", "c-dani2"),
  ];
  const result = await runQuery("מה התורים של דני?", items, undefined, {
    searchCustomers: async () => [
      {
        id: "c-dani1",
        name: "דני כהן",
        email: null,
        whatsappNumber: null,
        emailIsPlaceholder: true,
      },
      {
        id: "c-dani2",
        name: "דני לוי",
        email: null,
        whatsappNumber: null,
        emailIsPlaceholder: true,
      },
    ],
  });
  assert.match(result.answer, /למי התכוונת/);
  assert.match(result.answer, /דני כהן/);
  assert.match(result.answer, /דני לוי/);
  assert.equal(result.action, undefined);
});

test("read engine: unconfirmed arrival lists only pending confirmations", async () => {
  const items = [
    item("a-unconfirmed", "2026-07-08T07:00:00.000Z", "שרית", "c1"),
    item("a-ok", "2026-07-08T12:00:00.000Z", "דני", "c2"),
  ];
  const result = await runQuery("מי לא אישר הגעה?", items, undefined, {
    loadUnconfirmedAppointmentIds: async () => ["a-unconfirmed"],
  });
  assert.match(result.answer, /שרית/);
  assert.doesNotMatch(result.answer, /דני/);
  assert.match(result.answer, /לא אישרו הגעה|עדיין לא אישרו/);
});

test("read engine: unconfirmed arrival empty is friendly", async () => {
  const result = await runQuery(
    "מי לא אישר הגעה?",
    [item("a1", "2026-07-08T07:00:00.000Z", "שרית", "c1")],
    undefined,
    { loadUnconfirmedAppointmentIds: async () => [] }
  );
  assert.match(result.answer, /אין תורים ממתינים לאישור הגעה/);
});
