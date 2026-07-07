import test from "node:test";
import assert from "node:assert/strict";

import { calendarMessages, formatDayLabel } from "./calendarMessages.js";
import { buildCreateAppointmentResponse } from "../natalie.js";
import { parseCalendarIntent } from "./calendarIntentParser.js";

const NOW = new Date("2026-07-07T06:00:00.000Z");
const OPTS = { timeZone: "Asia/Jerusalem", now: NOW };

// ---- TASK 1 & 5: natural confirmation wording ----

test("confirmation reads like a human, not a robotic label", () => {
  const msg = calendarMessages.createConfirmation("שלום", "יום חמישי", "11:00");
  assert.equal(msg, "הבנתי שברצונך לקבוע פגישה עם שלום ביום חמישי בשעה 11:00.\nלאשר?");
  // No robotic "הבנתי:" colon form, no "לקבוע תור ל…".
  assert.doesNotMatch(msg, /הבנתי:/);
  assert.doesNotMatch(msg, /לקבוע תור ל/);
  // Echoes participant + day + time and asks to confirm.
  assert.match(msg, /שלום/);
  assert.match(msg, /ביום חמישי/);
  assert.match(msg, /11:00/);
  assert.match(msg, /לאשר\?/);
});

// ---- TASK 2, 6, 7: success echoes participant + date + time, no generic text ----

test("success message echoes participant, day and time in one clean line", () => {
  const msg = calendarMessages.createSuccess({
    clientName: "שלום",
    dayLabel: "יום חמישי",
    time: "11:00",
  });
  assert.match(msg, /שלום/);
  assert.match(msg, /ביום חמישי/);
  assert.match(msg, /11:00/);
  // Never generic / robotic.
  assert.doesNotMatch(msg, /הפעולה הושלמה/);
  assert.doesNotMatch(msg, /Request completed/i);
  assert.doesNotMatch(msg, /התור נקבע עבור/);
});

test("success message includes service and notes when present", () => {
  const msg = calendarMessages.createSuccess({
    clientName: "שלום",
    dayLabel: "מחר",
    time: "11:00",
    serviceName: "ייעוץ",
    notes: "להביא מסמכים",
  });
  assert.match(msg, /שלום/);
  assert.match(msg, /מחר/);
  assert.match(msg, /11:00/);
  assert.match(msg, /ייעוץ/);
  assert.match(msg, /להביא מסמכים/);
});

// ---- TASK 3: relative wording ----

test("formatDayLabel keeps relative days and adds preposition to weekdays", () => {
  assert.equal(formatDayLabel("מחר"), "מחר");
  assert.equal(formatDayLabel("היום"), "היום");
  assert.equal(formatDayLabel("מחרתיים"), "מחרתיים");
  assert.equal(formatDayLabel("יום חמישי"), "ביום חמישי");
  assert.equal(formatDayLabel("9/7"), "ב-9/7");
});

// ---- TASK 8: existing booking logic unchanged ----

test("booking proposal fields are unchanged by the copy polish", () => {
  const extraction = parseCalendarIntent("תקבעי לי פגישה עם שלום ביום חמישי בשעה 11 בבוקר", OPTS);
  const res = buildCreateAppointmentResponse(extraction);
  assert.ok(res && "action" in res && res.action === "book_appointment");
  assert.equal(res.proposal.clientName, "שלום");
  assert.equal(res.proposal.dayReference, "יום חמישי");
  assert.equal(res.proposal.time, "11:00");
  // The natural confirmation is attached as the answer.
  assert.equal(res.answer, "הבנתי שברצונך לקבוע פגישה עם שלום ביום חמישי בשעה 11:00.\nלאשר?");
});
