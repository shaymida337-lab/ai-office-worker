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
  assert.equal(parseHebrewTime("15:00"), "15:00");
  assert.equal(parseHebrewTime("8 בערב"), "20:00");
  assert.equal(parseHebrewTime("8 בבוקר"), "08:00");
  assert.equal(parseHebrewTime("בצהריים"), "12:00");
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
