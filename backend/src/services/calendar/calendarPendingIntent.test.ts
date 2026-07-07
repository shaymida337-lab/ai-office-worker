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
