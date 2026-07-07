import test from "node:test";
import assert from "node:assert/strict";
import {
  isCalendarFollowUpPhrase,
  mergeCalendarPendingIntent,
  parseInitialCalendarPendingIntent,
  recomputeMissingFields,
  type CalendarPendingIntent,
} from "./calendarPendingIntent.js";
import { isCancelAllTarget, parseCalendarIntent } from "./calendarIntentParser.js";

test("cancel-all parser: בטלי את כל התורים מחר", () => {
  const parsed = parseCalendarIntent("בטלי את כל התורים מחר");
  assert.equal(parsed.intent, "cancel_appointment");
  assert.equal(parsed.cancelTarget, "all");
  assert.equal(parsed.dayReference, "מחר");
  assert.deepEqual(parsed.missingFields, []);
});

test("day-only cancel asks for target, not customerName field", () => {
  const parsed = parseCalendarIntent("בטלי לי את הפגישות ביום חמישי");
  assert.equal(parsed.intent, "cancel_appointment");
  assert.equal(parsed.dayReference, "יום חמישי");
  assert.deepEqual(parsed.missingFields, ["target"]);
});

test("follow-up את כולם ביום חמישי merges into pending cancel state", () => {
  const pending: CalendarPendingIntent = {
    intent: "cancel_appointment",
    action: "cancel_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "יום חמישי",
    date: "2026-07-09",
    time: null,
    fromDayReference: null,
    fromTime: null,
    missingFields: ["target"],
    originalUserText: "בטלי לי את הפגישות ביום חמישי",
    lastAssistantQuestion: "לא הבנתי למי לבטל. מה שם הלקוח/ה?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeCalendarPendingIntent(pending, "את כולם ביום חמישי");
  assert.equal(merged.cancelTarget, "all");
  assert.equal(merged.action, "cancel_appointments");
  assert.deepEqual(merged.missingFields, []);
});

test("follow-up לא, מחר updates move date clarification", () => {
  const pending: CalendarPendingIntent = {
    intent: "move_appointment",
    action: "move_appointment",
    cancelTarget: null,
    customerName: "שרית",
    dayReference: "מחר",
    date: "2026-07-08",
    time: "16:00",
    fromDayReference: null,
    fromTime: null,
    missingFields: ["date"],
    originalUserText: "תעבירי את התור של שרית",
    lastAssistantQuestion: "לאיזה יום להעביר את התור?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeCalendarPendingIntent(pending, "לא, ביום שישי");
  assert.equal(merged.dayReference, "יום שישי");
  assert.equal(merged.missingFields.includes("date"), false);
});

test("isCalendarFollowUpPhrase recognizes Hebrew short replies", () => {
  assert.equal(isCalendarFollowUpPhrase("את כולם"), true);
  assert.equal(isCalendarFollowUpPhrase("כולם"), true);
  assert.equal(isCalendarFollowUpPhrase("את שרית"), true);
  assert.equal(isCancelAllTarget("את כל התורים"), true);
  assert.equal(isCancelAllTarget("תבטלי את כולם ביום חמישי"), true);
});

test("parseInitialCalendarPendingIntent captures partial cancel", () => {
  const pending = parseInitialCalendarPendingIntent("בטלי לי את הפגישות ביום חמישי");
  assert.ok(pending);
  assert.equal(pending?.intent, "cancel_appointment");
  assert.deepEqual(pending?.missingFields, ["target"]);
});

test("PROD BUG: create follow-up 'עם רונן' merges customer into pending create", () => {
  const pending = parseInitialCalendarPendingIntent("תקבעי לי פגישה ביום חמישי ב 10:00", {
    timeZone: "Asia/Jerusalem",
    now: new Date("2026-07-07T06:00:00.000Z"),
  });
  assert.ok(pending);
  assert.equal(pending?.intent, "create_appointment");
  assert.ok(pending?.missingFields.includes("customerName"));
  // Date + time captured up front must survive the merge.
  assert.equal(pending?.dayReference, "יום חמישי");
  assert.equal(pending?.time, "10:00");

  const merged = mergeCalendarPendingIntent(pending!, "עם רונן");
  assert.equal(merged.customerName, "רונן");
  assert.equal(merged.dayReference, "יום חמישי");
  assert.equal(merged.time, "10:00");
  assert.deepEqual(merged.missingFields, []);
});

test("create follow-up bare name 'רונן' also merges", () => {
  const pending: CalendarPendingIntent = {
    intent: "create_appointment",
    action: "create_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "יום חמישי",
    date: "2026-07-09",
    time: "10:00",
    fromDayReference: null,
    fromTime: null,
    missingFields: ["customerName"],
    originalUserText: "תקבעי לי פגישה ביום חמישי ב 10:00",
    lastAssistantQuestion: "לא הבנתי למי לקבוע את התור. מה שם הלקוח/ה?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeCalendarPendingIntent(pending, "רונן");
  assert.equal(merged.customerName, "רונן");
  assert.deepEqual(merged.missingFields, []);
});

test("create follow-up time 'בשעה 4' merges into pending create", () => {
  const pending: CalendarPendingIntent = {
    intent: "create_appointment",
    action: "create_appointment",
    cancelTarget: null,
    customerName: "רונן",
    dayReference: "יום חמישי",
    date: "2026-07-09",
    time: null,
    fromDayReference: null,
    fromTime: null,
    missingFields: ["time"],
    originalUserText: "תקבעי פגישה עם רונן ביום חמישי",
    lastAssistantQuestion: "באיזו שעה לקבוע את התור?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeCalendarPendingIntent(pending, "בשעה 4");
  assert.equal(merged.time, "16:00");
  assert.deepEqual(merged.missingFields, []);
});

test("follow-up customer for cancel keeps single target", () => {
  const pending: CalendarPendingIntent = {
    intent: "cancel_appointment",
    action: "cancel_appointment",
    cancelTarget: null,
    customerName: null,
    dayReference: "יום חמישי",
    date: "2026-07-09",
    time: null,
    fromDayReference: null,
    fromTime: null,
    missingFields: ["target"],
    originalUserText: "בטלי לי את הפגישות ביום חמישי",
    lastAssistantQuestion: "לא הבנתי למי לבטל. מה שם הלקוח/ה?",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const merged = mergeCalendarPendingIntent(pending, "את שרית");
  assert.equal(merged.customerName, "שרית");
  assert.equal(merged.cancelTarget, "single");
});

test("recomputeMissingFields: cancel all requires date only", () => {
  const fields = recomputeMissingFields({
    intent: "cancel_appointment",
    action: "cancel_appointments",
    cancelTarget: "all",
    customerName: null,
    dayReference: null,
    date: null,
    time: null,
    fromDayReference: null,
    fromTime: null,
    missingFields: [],
    originalUserText: "",
    lastAssistantQuestion: "",
    createdAt: "",
    expiresAt: "",
  });
  assert.deepEqual(fields, ["date"]);
});
