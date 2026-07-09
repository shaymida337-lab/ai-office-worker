import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCalendarIntent,
  parseHebrewTime,
  extractCustomerName,
  validateExtraction,
} from "./calendarIntentParser.js";

// Fixed anchor: Tue Jul 7 2026, 09:00 Asia/Jerusalem → "מחר" = Wed Jul 8 2026.
const NOW = new Date("2026-07-07T06:00:00.000Z");
const OPTS = { timeZone: "Asia/Jerusalem", now: NOW };

test('the real prod failure: "תקבעי תור לשרית מחר ב-3"', () => {
  const result = parseCalendarIntent("תקבעי תור לשרית מחר ב-3", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "שרית");
  assert.equal(result.dayReference, "מחר");
  assert.equal(result.date, "2026-07-08");
  assert.equal(result.time, "15:00");
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.confidence, "high");
});

test('"תקבעי לשרית מחר בשלוש" → שרית / מחר / 15:00', () => {
  const result = parseCalendarIntent("תקבעי לשרית מחר בשלוש", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "שרית");
  assert.equal(result.dayReference, "מחר");
  assert.equal(result.time, "15:00");
  assert.deepEqual(result.missingFields, []);
});

test('"קבעי תור לשרית מחר בשעה 15:00" → 15:00 verbatim', () => {
  const result = parseCalendarIntent("קבעי תור לשרית מחר בשעה 15:00", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "שרית");
  assert.equal(result.dayReference, "מחר");
  assert.equal(result.time, "15:00");
});

test('"תקבעי תור לדני ביום חמישי ב-8 בערב" → דני / חמישי / 20:00', () => {
  const result = parseCalendarIntent("תקבעי תור לדני ביום חמישי ב-8 בערב", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "דני");
  assert.equal(result.dayReference, "יום חמישי");
  assert.equal(result.time, "20:00");
});

test('"תבטלי את התור של שרית מחר" → cancel / שרית / מחר', () => {
  const result = parseCalendarIntent("תבטלי את התור של שרית מחר", OPTS);
  assert.equal(result.intent, "cancel_appointment");
  assert.equal(result.customerName, "שרית");
  assert.equal(result.dayReference, "מחר");
});

test('"תזיזי את התור של שרית ממחר בשלוש למחר בארבע" → move 15:00 → 16:00', () => {
  const result = parseCalendarIntent(
    "תזיזי את התור של שרית ממחר בשלוש למחר בארבע",
    OPTS
  );
  assert.equal(result.intent, "move_appointment");
  assert.equal(result.customerName, "שרית");
  assert.equal(result.fromDayReference, "מחר");
  assert.equal(result.fromTime, "15:00");
  assert.equal(result.dayReference, "מחר");
  assert.equal(result.time, "16:00");
});

test("never invents a customer name from explanation words", () => {
  assert.equal(extractCustomerName("הבנתי בצורה ברורה שצריך לקבוע תור"), null);
  assert.equal(extractCustomerName("צריך לקבוע תור מחר"), null);
});

test("time parser: bare afternoon default and morning/evening context", () => {
  assert.equal(parseHebrewTime("ב-3"), "15:00");
  assert.equal(parseHebrewTime("בשלוש"), "15:00");
  assert.equal(parseHebrewTime("בשעה 3"), "15:00");
  assert.equal(parseHebrewTime("ב 3"), "15:00");
  assert.equal(parseHebrewTime("מחרתיים ב-08:30"), "08:30");
  assert.equal(parseHebrewTime("מחר ב-09:15"), "09:15");
  assert.equal(parseHebrewTime("15:00"), "15:00");
  assert.equal(parseHebrewTime("15:30"), "15:30");
  assert.equal(parseHebrewTime("8 בערב"), "20:00");
  assert.equal(parseHebrewTime("8 בבוקר"), "08:00");
  assert.equal(parseHebrewTime("בצהריים"), "12:00");
});

test('hebrew half-hour parses as :30 in create sentence with prefix ב', () => {
  const result = parseCalendarIntent("קבעי תור לדנה מחר בשלוש וחצי", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "דנה");
  assert.equal(result.time, "15:30");
});

test('hebrew half-hour parses as :30 without prefix ב', () => {
  const result = parseCalendarIntent("קבעי תור לדנה מחר שלוש וחצי", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "דנה");
  assert.equal(result.time, "15:30");
});

test('explicit numeric 15:30 remains unchanged', () => {
  const result = parseCalendarIntent("קבעי תור לדנה מחר ב-15:30", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "דנה");
  assert.equal(result.time, "15:30");
});

test("validateExtraction rejects noise customer names and unparsed times", () => {
  const noisy = parseCalendarIntent("תקבעי תור לשרית מחר ב-3", OPTS);
  const withNoise = { ...noisy, customerName: "בצורה ברורה" };
  const check = validateExtraction(withNoise);
  assert.equal(check.valid, false);
  assert.ok(check.issues.includes("customerName_is_noise"));

  const good = validateExtraction(noisy);
  assert.equal(good.valid, true);
  assert.deepEqual(good.issues, []);
});

test("conservative: uncertain input yields low confidence and missing fields", () => {
  const result = parseCalendarIntent("תקבעי תור מחר", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, null);
  assert.equal(result.confidence, "low");
  assert.ok(result.missingFields.includes("customerName"));
  assert.ok(result.missingFields.includes("time"));
});

test('list: "מה יש לי מחר ביומן?" → list_appointments / day / מחר', () => {
  const result = parseCalendarIntent("מה יש לי מחר ביומן?", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.rangeType, "day");
  assert.equal(result.dayReference, "מחר");
});

test('list: "מה התורים שלי?" → list_appointments / all', () => {
  const result = parseCalendarIntent("מה התורים שלי?", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.rangeType, "all");
  assert.equal(result.dayReference, null);
});

test('list: "מה יש לי ביום שני?" → list_appointments / יום שני', () => {
  const result = parseCalendarIntent("מה יש לי ביום שני?", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.rangeType, "day");
  assert.equal(result.dayReference, "יום שני");
});

test('list: "תראי לי את התורים של מחר" → list_appointments / מחר', () => {
  const result = parseCalendarIntent("תראי לי את התורים של מחר", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.dayReference, "מחר");
});

test('list: "כמה תורים יש לי השבוע?" → list_appointments / week / count', () => {
  const result = parseCalendarIntent("כמה תורים יש לי השבוע?", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.rangeType, "week");
  assert.equal(result.readMode, "count");
});

test('next: "מה הפגישה הבאה שלי?" → list_appointments / next', () => {
  const result = parseCalendarIntent("מה הפגישה הבאה שלי?", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.readMode, "next");
  assert.equal(result.nextFocus, "appointment");
});

test('next: "מה התור הבא שלי?" → list_appointments / next', () => {
  const result = parseCalendarIntent("מה התור הבא שלי?", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.readMode, "next");
});

test('next: "מי הלקוח הבא?" → next / client focus', () => {
  const result = parseCalendarIntent("מי הלקוח הבא?", OPTS);
  assert.equal(result.readMode, "next");
  assert.equal(result.nextFocus, "client");
});

test('count: "כמה פגישות יש לי מחר?" → count / מחר', () => {
  const result = parseCalendarIntent("כמה פגישות יש לי מחר?", OPTS);
  assert.equal(result.readMode, "count");
  assert.equal(result.dayReference, "מחר");
});

test("list detection never hijacks a create/cancel/move command", () => {
  assert.equal(parseCalendarIntent("תקבעי תור לשרית מחר ב-3", OPTS).intent, "create_appointment");
  assert.equal(parseCalendarIntent("תבטלי את התור של שרית מחר", OPTS).intent, "cancel_appointment");
  assert.equal(
    parseCalendarIntent("תזיזי את התור של שרית ממחר בשלוש למחר בארבע", OPTS).intent,
    "move_appointment"
  );
});

// ---- World-class command set (real production failures) ----

test('PROD BUG: "תקבעי לי פגישה עם רונן ביום חמישי ב 10:00 בבוקר" → complete, no clarification', () => {
  const result = parseCalendarIntent(
    "תקבעי לי פגישה עם רונן ביום חמישי ב 10:00 בבוקר",
    OPTS
  );
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "רונן");
  assert.equal(result.dayReference, "יום חמישי");
  assert.equal(result.time, "10:00");
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.confidence, "high");
});

test('customer after עם / לרונן / של — never asks for the name that is present', () => {
  assert.equal(extractCustomerName("תקבעי לי פגישה עם רונן ביום חמישי ב 10:00 בבוקר"), "רונן");
  assert.equal(extractCustomerName("תקבעי תור לרונן מחר ב-3"), "רונן");
  assert.equal(extractCustomerName("קבעי לי תור עם שרית ביום ראשון בשעה 12"), "שרית");
  assert.equal(extractCustomerName("בטלי לי את התור של רונן מחר"), "רונן");
});

test("create command extracts full multi-word customer name before date boundary", () => {
  const text = "קבעי תור לבדיקה רון כהן מחר ב-15:30";
  assert.equal(extractCustomerName(text), "בדיקה רון כהן");
  const parsed = parseCalendarIntent(text, OPTS);
  assert.equal(parsed.intent, "create_appointment");
  assert.equal(parsed.customerName, "בדיקה רון כהן");
  assert.equal(parsed.time, "15:30");
});

test("create command keeps full business/customer name tokens before time boundary", () => {
  const text = "קבעי תור לרגרסיה לקוח חדש bd5565 מחר ב-12:15";
  assert.equal(extractCustomerName(text), "רגרסיה לקוח חדש bd5565");
  const parsed = parseCalendarIntent(text, OPTS);
  assert.equal(parsed.intent, "create_appointment");
  assert.equal(parsed.customerName, "רגרסיה לקוח חדש bd5565");
  assert.equal(parsed.time, "12:15");
});

test("create command keeps mixed Hebrew/Latin digit token in customer name", () => {
  const text = "קבעי תור לרגרסיה לקוח חדש 0b131b מחר ב-12:15";
  assert.equal(extractCustomerName(text), "רגרסיה לקוח חדש 0b131b");
  const parsed = parseCalendarIntent(text, OPTS);
  assert.equal(parsed.intent, "create_appointment");
  assert.equal(parsed.customerName, "רגרסיה לקוח חדש 0b131b");
  assert.equal(parsed.time, "12:15");
});

test("create command keeps Hebrew + Latin token in customer name", () => {
  const text = "קבעי תור ללקוח A123 מחר ב-12:15";
  assert.equal(extractCustomerName(text), "לקוח A123");
  const parsed = parseCalendarIntent(text, OPTS);
  assert.equal(parsed.intent, "create_appointment");
  assert.equal(parsed.customerName, "לקוח A123");
  assert.equal(parsed.time, "12:15");
});

test("create command still extracts simple single-word customer name", () => {
  const text = "קבעי תור לדנה מחר ב-18:45";
  assert.equal(extractCustomerName(text), "דנה");
  const parsed = parseCalendarIntent(text, OPTS);
  assert.equal(parsed.intent, "create_appointment");
  assert.equal(parsed.customerName, "דנה");
  assert.equal(parsed.time, "18:45");
});

test("create commands extract customerName from Hebrew prepositions", () => {
  const cases = [
    { text: "קבעי תור לשרון יום שישי ב-15:00", customerName: "שרון", time: "15:00" },
    { text: "תקבע פגישה לרון מחר ב-16:00", customerName: "רון", time: "16:00" },
    { text: "קבעי פגישה עם דנה ביום חמישי ב-10", customerName: "דנה", time: "10:00" },
    { text: "קבעי תור עבור שרון יום שישי ב-15:00", customerName: "שרון", time: "15:00" },
    { text: "תזמני תור עבור יעל ביום ראשון בשעה 12", customerName: "יעל", time: "12:00" },
    { text: "קבעי תור ללקוחה מיכל מחר ב-9", customerName: "מיכל", time: null },
  ];
  for (const sample of cases) {
    const result = parseCalendarIntent(sample.text, OPTS);
    assert.equal(result.intent, "create_appointment");
    assert.equal(result.customerName, sample.customerName, sample.text);
    if (sample.time) {
      assert.equal(result.time, sample.time, sample.text);
    } else {
      assert.notEqual(result.time, null, sample.text);
    }
    assert.equal(result.missingFields.includes("customerName"), false, sample.text);
  }
});

test('"לי" is never mistaken for a customer name', () => {
  const result = parseCalendarIntent("תקבעי לי פגישה ביום חמישי ב 10:00", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, null);
  assert.ok(result.missingFields.includes("customerName"));
});

test('punctuation cleanup: "קבעי, תור עבור דנה — מחר ב-11:45!" extracts clean name', () => {
  const result = parseCalendarIntent("קבעי, תור עבור דנה — מחר ב-11:45!", OPTS);
  assert.equal(result.intent, "create_appointment");
  assert.equal(result.customerName, "דנה");
  assert.equal(result.time, "11:45");
});

test('"לשלוש" is never mistaken for a customer name in move commands', () => {
  const result = parseCalendarIntent("תעבירי את התור של שרית ביום שני לשלוש", OPTS);
  assert.equal(result.intent, "move_appointment");
  assert.equal(result.customerName, "שרית");
  assert.equal(result.time, "15:00");
});

test('PROD BUG: "איזה פגישות יש לי ביום חמישי" → list (was unanswered)', () => {
  const result = parseCalendarIntent("איזה פגישות יש לי ביום חמישי", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.dayReference, "יום חמישי");
  assert.deepEqual(result.missingFields, []);
});

test('list: "מי קבוע לי היום" → list / היום', () => {
  const result = parseCalendarIntent("מי קבוע לי היום", OPTS);
  assert.equal(result.intent, "list_appointments");
  assert.equal(result.dayReference, "היום");
});

test('reschedule with עם and bare שני: "שני את הפגישה של דנה ליום ראשון ב 10"', () => {
  const result = parseCalendarIntent("שני את הפגישה של דנה ליום ראשון ב 10", OPTS);
  assert.equal(result.intent, "move_appointment");
  assert.equal(result.customerName, "דנה");
  assert.equal(result.dayReference, "יום ראשון");
  assert.equal(result.time, "10:00");
});

test('reschedule: "תעבירי את הפגישה עם רונן מיום חמישי לשעה 12"', () => {
  const result = parseCalendarIntent("תעבירי את הפגישה עם רונן מיום חמישי לשעה 12", OPTS);
  assert.equal(result.intent, "move_appointment");
  assert.equal(result.customerName, "רונן");
  assert.equal(result.time, "12:00");
});

test('cancel-all: "תבטלי את כולם ביום חמישי" → cancelTarget all, no customer', () => {
  const result = parseCalendarIntent("תבטלי את כולם ביום חמישי", OPTS);
  assert.equal(result.intent, "cancel_appointment");
  assert.equal(result.cancelTarget, "all");
  assert.equal(result.customerName, null);
  assert.equal(result.dayReference, "יום חמישי");
  assert.deepEqual(result.missingFields, []);
});

test('"ב 10:00 בבוקר" resolves to 10:00, never 22:00', () => {
  assert.equal(parseHebrewTime("ב 10:00 בבוקר"), "10:00");
});
