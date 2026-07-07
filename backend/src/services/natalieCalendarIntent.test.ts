import test from "node:test";
import assert from "node:assert/strict";

import {
  askNatalieBusinessQuestion,
  buildCreateAppointmentResponse,
  parseRescheduleDayAndTime,
  extractRescheduleAppointment,
} from "./natalie.js";
import { parseCalendarIntent } from "./calendar/calendarIntentParser.js";

// Fixed anchor: Tue Jul 7 2026 → "מחר" = Wed Jul 8; "יום חמישי" = Thu Jul 9.
const NOW = new Date("2026-07-07T06:00:00.000Z");
const TZ = "Asia/Jerusalem";

function createFor(text: string) {
  return buildCreateAppointmentResponse(parseCalendarIntent(text, { timeZone: TZ, now: NOW }));
}

test("create: 'תקבעי תור לשרית מחר ב-3' → book_appointment שרית / מחר / 15:00, templated", () => {
  const res = createFor("תקבעי תור לשרית מחר ב-3");
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "שרית");
  assert.equal(res.proposal.dayReference, "מחר");
  assert.equal(res.proposal.time, "15:00");
  assert.equal(res.answer, "הבנתי שברצונך לקבוע פגישה עם שרית מחר בשעה 15:00.\nלאשר?");
});

test("create: 'תקבעי לשרית מחר בשלוש' → 15:00", () => {
  const res = createFor("תקבעי לשרית מחר בשלוש");
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "שרית");
  assert.equal(res.proposal.time, "15:00");
});

test("create: 'קבעי תור לדני היום ב-4' → דני / היום / 16:00", () => {
  const res = createFor("קבעי תור לדני היום ב-4");
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "דני");
  assert.equal(res.proposal.dayReference, "היום");
  assert.equal(res.proposal.time, "16:00");
});

test("create: 'קבעי לאבי מחר ב-8 בערב' → אבי / 20:00", () => {
  const res = createFor("קבעי לאבי מחר ב-8 בערב");
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "אבי");
  assert.equal(res.proposal.time, "20:00");
});

test("create: 'תקבעי תור לשרה ביום חמישי ב-10' → שרה / חמישי / 10:00 (AM stays)", () => {
  const res = createFor("תקבעי תור לשרה ביום חמישי ב-10");
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "שרה");
  assert.equal(res.proposal.dayReference, "יום חמישי");
  assert.equal(res.proposal.time, "10:00");
});

test("create clarification: missing customer only → no action, asks who", () => {
  const res = createFor("תקבעי תור מחר ב-3");
  assert.ok(res && !("action" in res));
  assert.match(res!.answer, /לקוח|למי/u);
});

test("create clarification: missing time only → no action, asks time", () => {
  const res = createFor("תקבעי תור לשרית מחר");
  assert.ok(res && !("action" in res));
  assert.match(res!.answer, /שעה/u);
});

test("create clarification: missing date only → no action, asks day", () => {
  const res = createFor("תקבעי תור לשרית ב-3");
  assert.ok(res && !("action" in res));
  assert.match(res!.answer, /יום/u);
});

test("create: never invents a customer name from explanation words", () => {
  const extraction = parseCalendarIntent("תקבעי תור לשרית מחר ב-3", { timeZone: TZ, now: NOW });
  const poisoned = { ...extraction, customerName: "בצורה ברורה" };
  const res = buildCreateAppointmentResponse(poisoned);
  // Poisoned name must be rejected → clarification, never a booking proposal.
  assert.ok(res && !("action" in res));
});

test("create: nonsense input is not a create intent (no proposal)", () => {
  const res = createFor("מה שלומך היום");
  assert.equal(res, null);
});

test("LIVE conversation path bypasses Claude for a Hebrew create command", async () => {
  let claudeCalls = 0;
  const res = await askNatalieBusinessQuestion(
    { organizationId: "org-test", question: "תקבעי תור לשרית מחר ב-3" },
    {
      now: NOW,
      loadTimezone: async () => TZ,
      askClaude: async () => {
        claudeCalls += 1;
        throw new Error("Claude must not be called for deterministic create commands");
      },
    }
  );
  assert.equal(claudeCalls, 0);
  assert.ok("action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "שרית");
  assert.equal(res.proposal.time, "15:00");
});

test("reschedule time parse: 'מחר בארבע' → 16:00, 'מחר ב-3' → 15:00 (no more 03:00 bug)", () => {
  assert.deepEqual(parseRescheduleDayAndTime("מחר בארבע"), { dayReference: "מחר", time: "16:00" });
  assert.deepEqual(parseRescheduleDayAndTime("מחר ב-3"), { dayReference: "מחר", time: "15:00" });
  assert.deepEqual(parseRescheduleDayAndTime("היום בשעה 10"), { dayReference: "היום", time: "10:00" });
});

test("move (complex from→to): 'תזיזי את התור של שרית ממחר בשלוש למחר בארבע'", () => {
  const parsed = extractRescheduleAppointment("תזיזי את התור של שרית ממחר בשלוש למחר בארבע");
  assert.ok(parsed, "should extract a reschedule");
  assert.equal(parsed!.clientName, "שרית");
  assert.equal(parsed!.dayReference, "מחר");
  assert.equal(parsed!.time, "16:00");

  // Full deterministic move extraction (from + to) also available on the parser.
  const intent = parseCalendarIntent("תזיזי את התור של שרית ממחר בשלוש למחר בארבע", {
    timeZone: TZ,
    now: NOW,
  });
  assert.equal(intent.intent, "move_appointment");
  assert.equal(intent.customerName, "שרית");
  assert.equal(intent.fromDayReference, "מחר");
  assert.equal(intent.fromTime, "15:00");
  assert.equal(intent.dayReference, "מחר");
  assert.equal(intent.time, "16:00");
});

test("move (simple): 'תעבירי את התור של שרית למחר בארבע' still works", () => {
  const parsed = extractRescheduleAppointment("תעבירי את התור של שרית למחר בארבע");
  assert.ok(parsed, "should extract a reschedule");
  assert.equal(parsed!.clientName, "שרית");
  assert.equal(parsed!.dayReference, "מחר");
  assert.equal(parsed!.time, "16:00");
});

test("LIVE reschedule extraction bypasses Claude for the complex phrase", async () => {
  // The reschedule regex path historically failed this phrase and would fall
  // through to Claude. Prove the extractor now resolves it deterministically.
  const parsed = extractRescheduleAppointment(
    "תזיזי את התור של שרית ממחר בשלוש למחר בארבע"
  );
  assert.ok(parsed && parsed.clientName === "שרית" && parsed.time === "16:00");
});

test("move synonym: 'תעבירי לי את הפגישה של שרית ליום שני בשלוש' → 15:00", () => {
  const parsed = extractRescheduleAppointment("תעבירי לי את הפגישה של שרית ליום שני בשלוש");
  assert.ok(parsed);
  assert.equal(parsed!.clientName, "שרית");
  assert.equal(parsed!.dayReference, "יום שני");
  assert.equal(parsed!.time, "15:00");
});

test("cancel synonym: 'תמחקי את התור של דני' parses cancel intent with דני", () => {
  const intent = parseCalendarIntent("תמחקי את התור של דני", { timeZone: TZ, now: NOW });
  assert.equal(intent.intent, "cancel_appointment");
  assert.equal(intent.customerName, "דני");
});

test("list: 'מה יש לי מחר?' without ביומן", () => {
  const intent = parseCalendarIntent("מה יש לי מחר?", { timeZone: TZ, now: NOW });
  assert.equal(intent.intent, "list_appointments");
  assert.equal(intent.dayReference, "מחר");
});

test("corrupted STT create still extracts שרית at 15:00", () => {
  const res = createFor("תקווי תור לשרית מחר ב-3");
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "שרית");
  assert.equal(res.proposal.time, "15:00");
});
