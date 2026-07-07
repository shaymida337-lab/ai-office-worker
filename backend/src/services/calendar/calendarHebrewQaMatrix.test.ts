import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCalendarIntent,
  type CalendarIntentAction,
  type CalendarListRange,
} from "./calendarIntentParser.js";
import { buildCreateAppointmentResponse } from "../natalie.js";
import { extractRescheduleAppointment } from "../natalie.js";
import { parseAvailabilityIntent } from "../natalieAvailability.js";
import { calendarMessages } from "./calendarMessages.js";

const NOW = new Date("2026-07-07T06:00:00.000Z");
const OPTS = { timeZone: "Asia/Jerusalem", now: NOW };

type QaExpect = {
  intent: CalendarIntentAction | "availability" | "unknown";
  customerName?: string | null;
  dayReference?: string | null;
  time?: string | null;
  rangeType?: CalendarListRange;
  missing?: string[];
  /** For move: extractRescheduleAppointment must succeed. */
  reschedule?: boolean;
  /** For create: must produce book_appointment proposal. */
  book?: boolean;
  /** For create: must NOT produce book_appointment (clarification only). */
  clarify?: boolean;
};

type QaCase = { id: string; category: string; phrase: string; expect: QaExpect };

/** 100-phrase Hebrew calendar QA matrix — parser + high-level response builders. */
const QA_MATRIX: QaCase[] = [
  // ---- create (15) ----
  { id: "C01", category: "create", phrase: "תקבעי תור לשרית מחר ב-3", expect: { intent: "create_appointment", customerName: "שרית", dayReference: "מחר", time: "15:00", book: true } },
  { id: "C02", category: "create", phrase: "תקבעי לשרית מחר בשלוש", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "C03", category: "create", phrase: "קבעי תור לדני היום ב-4", expect: { intent: "create_appointment", customerName: "דני", dayReference: "היום", time: "16:00", book: true } },
  { id: "C04", category: "create", phrase: "שימי לי תור לשרית מחר ב-3", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "C05", category: "create", phrase: "תכניסי לשרית מחר ב-4", expect: { intent: "create_appointment", customerName: "שרית", time: "16:00", book: true } },
  { id: "C06", category: "create", phrase: "תרשמי תור לדני מחר בשעה 10", expect: { intent: "create_appointment", customerName: "דני", time: "10:00", book: true } },
  { id: "C07", category: "create", phrase: "תזמני פגישה לשרית מחר ב-3", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "C08", category: "create", phrase: "קבעי פגישה לאבי מחר ב-8 בערב", expect: { intent: "create_appointment", customerName: "אבי", time: "20:00", book: true } },
  { id: "C09", category: "create", phrase: "תקבעי תור לשרה ביום חמישי ב-10", expect: { intent: "create_appointment", customerName: "שרה", dayReference: "יום חמישי", time: "10:00", book: true } },
  { id: "C10", category: "create", phrase: "תקבעי תור לשרית מחר בשעה 15:00", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "C11", category: "create", phrase: "לקבוע תור לדני מחר ב-5", expect: { intent: "create_appointment", customerName: "דני", time: "17:00", book: true } },
  { id: "C12", category: "create", phrase: "תקווי תור לשרית מחר ב-3", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "C13", category: "create", phrase: "תור לשרית מחר ב-3", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "C14", category: "create", phrase: "תקבעי תור לדני ביום שני ב-9", expect: { intent: "create_appointment", customerName: "דני", dayReference: "יום שני", time: "21:00", book: true } },
  { id: "C15", category: "create", phrase: "תכניסי פגישה לשרית מחרתיים ב-2", expect: { intent: "create_appointment", customerName: "שרית", dayReference: "מחרתיים", time: "14:00", book: true } },

  // ---- move (15) ----
  { id: "M01", category: "move", phrase: "תזיזי את התור של שרית ממחר בשלוש למחר בארבע", expect: { intent: "move_appointment", customerName: "שרית", time: "16:00", reschedule: true } },
  { id: "M02", category: "move", phrase: "תעבירי את התור של שרית למחר בארבע", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "16:00", reschedule: true } },
  { id: "M03", category: "move", phrase: "תעבירי לי את הפגישה של שרית ליום שני בשלוש", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "יום שני", time: "15:00", reschedule: true } },
  { id: "M04", category: "move", phrase: "תדחי את התור של דני למחר בארבע", expect: { intent: "move_appointment", customerName: "דני", dayReference: "מחר", time: "16:00", reschedule: true } },
  { id: "M05", category: "move", phrase: "תעבירי את התור של שרית ביום שני לשלוש", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "יום שני", time: "15:00", reschedule: true } },
  { id: "M06", category: "move", phrase: "להעביר את הפגישה של שרית למחר ב-3", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "15:00", reschedule: true } },
  { id: "M07", category: "move", phrase: "תשני את התור של דני ליום רביעי ב-11", expect: { intent: "move_appointment", customerName: "דני", dayReference: "יום רביעי", time: "11:00", reschedule: true } },
  { id: "M08", category: "move", phrase: "תזיזי את הפגישה של שרית למחר בשלוש", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "15:00", reschedule: true } },
  { id: "M09", category: "move", phrase: "תעביר את התור של יוסי להיום ב-4", expect: { intent: "move_appointment", customerName: "יוסי", dayReference: "היום", time: "16:00", reschedule: true } },
  { id: "M10", category: "move", phrase: "תדחה את הפגישה של שרית ליום שישי ב-8 בערב", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "יום שישי", time: "20:00", reschedule: true } },
  { id: "M11", category: "move", phrase: "תעבירי את התור של שרית למחר ב-16:00", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "16:00", reschedule: true } },
  { id: "M12", category: "move", phrase: "תזיזי לשרית את התור למחר בשלוש", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "15:00", reschedule: true } },
  { id: "M13", category: "move", phrase: "שנה מועד את התור של דני למחר ב-5", expect: { intent: "move_appointment", customerName: "דני", dayReference: "מחר", time: "17:00", reschedule: true } },
  { id: "M14", category: "move", phrase: "תעבירי את התור של שרית ממחר בשלוש למחר בארבע", expect: { intent: "move_appointment", customerName: "שרית", time: "16:00", reschedule: true } },
  { id: "M15", category: "move", phrase: "לדחות את הפגישה של שרית למחר ב-3", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "15:00", reschedule: true } },

  // ---- cancel (15) ----
  { id: "X01", category: "cancel", phrase: "תבטלי את התור של שרית מחר", expect: { intent: "cancel_appointment", customerName: "שרית", dayReference: "מחר" } },
  { id: "X02", category: "cancel", phrase: "תבטלי את הפגישה של שרית מחר", expect: { intent: "cancel_appointment", customerName: "שרית", dayReference: "מחר" } },
  { id: "X03", category: "cancel", phrase: "תמחקי את התור של דני", expect: { intent: "cancel_appointment", customerName: "דני" } },
  { id: "X04", category: "cancel", phrase: "תורידי את הפגישה של שרית", expect: { intent: "cancel_appointment", customerName: "שרית" } },
  { id: "X05", category: "cancel", phrase: "בטלי את התור של דני מחר", expect: { intent: "cancel_appointment", customerName: "דני", dayReference: "מחר" } },
  { id: "X06", category: "cancel", phrase: "לבטל את התור של שרית", expect: { intent: "cancel_appointment", customerName: "שרית" } },
  { id: "X07", category: "cancel", phrase: "ביטול תור של דני", expect: { intent: "cancel_appointment", customerName: "דני" } },
  { id: "X08", category: "cancel", phrase: "תבטלי תור של שרית מחר", expect: { intent: "cancel_appointment", customerName: "שרית", dayReference: "מחר" } },
  { id: "X09", category: "cancel", phrase: "תמחקי את הפגישה של שרית מחר", expect: { intent: "cancel_appointment", customerName: "שרית", dayReference: "מחר" } },
  { id: "X10", category: "cancel", phrase: "תבטלי את התור של יוסי ביום שני", expect: { intent: "cancel_appointment", customerName: "יוסי", dayReference: "יום שני" } },
  { id: "X11", category: "cancel", phrase: "תורידי את התור של דני היום", expect: { intent: "cancel_appointment", customerName: "דני", dayReference: "היום" } },
  { id: "X12", category: "cancel", phrase: "תבטלי את הפגישה של שרה", expect: { intent: "cancel_appointment", customerName: "שרה" } },
  { id: "X13", category: "cancel", phrase: "בטל את התור של דני מחר", expect: { intent: "cancel_appointment", customerName: "דני", dayReference: "מחר" } },
  { id: "X14", category: "cancel", phrase: "תבטלי את התור של שרית מחרתיים", expect: { intent: "cancel_appointment", customerName: "שרית", dayReference: "מחרתיים" } },
  { id: "X15", category: "cancel", phrase: "למחוק את התור של דני", expect: { intent: "cancel_appointment", customerName: "דני" } },

  // ---- list (15) ----
  { id: "L01", category: "list", phrase: "מה יש לי מחר ביומן?", expect: { intent: "list_appointments", dayReference: "מחר", rangeType: "day" } },
  { id: "L02", category: "list", phrase: "מה יש לי מחר?", expect: { intent: "list_appointments", dayReference: "מחר", rangeType: "day" } },
  { id: "L03", category: "list", phrase: "מה התורים שלי?", expect: { intent: "list_appointments", rangeType: "all" } },
  { id: "L04", category: "list", phrase: "מה יש לי היום ביומן?", expect: { intent: "list_appointments", dayReference: "היום", rangeType: "day" } },
  { id: "L05", category: "list", phrase: "מה יש לי השבוע?", expect: { intent: "list_appointments", rangeType: "week" } },
  { id: "L06", category: "list", phrase: "מה הפגישות שלי השבוע?", expect: { intent: "list_appointments", rangeType: "week" } },
  { id: "L07", category: "list", phrase: "כמה תורים יש לי היום?", expect: { intent: "list_appointments", dayReference: "היום", rangeType: "day" } },
  { id: "L08", category: "list", phrase: "כמה תורים יש לי מחר?", expect: { intent: "list_appointments", dayReference: "מחר", rangeType: "day" } },
  { id: "L09", category: "list", phrase: "תראי לי את התורים של מחר", expect: { intent: "list_appointments", dayReference: "מחר", rangeType: "day" } },
  { id: "L10", category: "list", phrase: "תראי לי את היומן של מחר", expect: { intent: "list_appointments", dayReference: "מחר", rangeType: "day" } },
  { id: "L11", category: "list", phrase: "תראי לי את היום שלי", expect: { intent: "list_appointments", dayReference: "היום", rangeType: "day" } },
  { id: "L12", category: "list", phrase: "מה יש לי ביום שני?", expect: { intent: "list_appointments", dayReference: "יום שני", rangeType: "day" } },
  { id: "L13", category: "list", phrase: "מה קורה ביומן מחר?", expect: { intent: "list_appointments", dayReference: "מחר", rangeType: "day" } },
  { id: "L14", category: "list", phrase: "כמה פגישות יש לי השבוע?", expect: { intent: "list_appointments", rangeType: "week" } },
  { id: "L15", category: "list", phrase: "תראי לי את הפגישות של היום", expect: { intent: "list_appointments", dayReference: "היום", rangeType: "day" } },

  // ---- availability (10) ----
  { id: "A01", category: "availability", phrase: "מתי אני פנוי מחר?", expect: { intent: "availability" } },
  { id: "A02", category: "availability", phrase: "מה פנוי מחר?", expect: { intent: "availability" } },
  { id: "A03", category: "availability", phrase: "יש לי מקום מחר ב-3?", expect: { intent: "availability" } },
  { id: "A04", category: "availability", phrase: "האם פנוי מחר בשעה 15:00?", expect: { intent: "availability" } },
  { id: "A05", category: "availability", phrase: "מתי פנוי היום?", expect: { intent: "availability" } },
  { id: "A06", category: "availability", phrase: "איזה שעות פנויות מחר?", expect: { intent: "availability" } },
  { id: "A07", category: "availability", phrase: "מה השעות הפנויות ביום שני?", expect: { intent: "availability" } },
  { id: "A08", category: "availability", phrase: "יש תור פנוי מחר בבוקר?", expect: { intent: "availability" } },
  { id: "A09", category: "availability", phrase: "מתי יש לי חלון פנוי מחר?", expect: { intent: "availability" } },
  { id: "A10", category: "availability", phrase: "האם יש מקום היום ב-4?", expect: { intent: "availability" } },

  // ---- missing customer (8) ----
  { id: "MC01", category: "missing_customer", phrase: "תקבעי תור מחר ב-3", expect: { intent: "create_appointment", missing: ["customerName"], clarify: true } },
  { id: "MC02", category: "missing_customer", phrase: "תבטלי את התור מחר", expect: { intent: "cancel_appointment", missing: ["customerName"] } },
  { id: "MC03", category: "missing_customer", phrase: "תעבירי את התור למחר ב-4", expect: { intent: "move_appointment", missing: ["customerName"] } },
  { id: "MC04", category: "missing_customer", phrase: "תמחקי את התור מחר", expect: { intent: "cancel_appointment", missing: ["customerName"] } },
  { id: "MC05", category: "missing_customer", phrase: "תדחי את התור למחר", expect: { intent: "move_appointment", missing: ["customerName"] } },
  { id: "MC06", category: "missing_customer", phrase: "שימי לי תור מחר ב-3", expect: { intent: "create_appointment", missing: ["customerName"], clarify: true } },
  { id: "MC07", category: "missing_customer", phrase: "תכניסי פגישה מחר ב-3", expect: { intent: "create_appointment", missing: ["customerName"], clarify: true } },
  { id: "MC08", category: "missing_customer", phrase: "בטלי את התור מחר", expect: { intent: "cancel_appointment", missing: ["customerName"] } },

  // ---- missing date (6) ----
  { id: "MD01", category: "missing_date", phrase: "תקבעי תור לשרית ב-3", expect: { intent: "create_appointment", customerName: "שרית", missing: ["date"], clarify: true } },
  { id: "MD02", category: "missing_date", phrase: "תעבירי את התור של שרית לשלוש", expect: { intent: "move_appointment", customerName: "שרית", missing: ["date"] } },
  { id: "MD03", category: "missing_date", phrase: "תדחי את התור של דני לשלוש", expect: { intent: "move_appointment", customerName: "דני", missing: ["date"] } },
  { id: "MD04", category: "missing_date", phrase: "תקבעי תור לדני בשעה 15:00", expect: { intent: "create_appointment", customerName: "דני", missing: ["date"], clarify: true } },
  { id: "MD05", category: "missing_date", phrase: "תזמני לשרית ב-4", expect: { intent: "create_appointment", customerName: "שרית", missing: ["date"], clarify: true } },
  { id: "MD06", category: "missing_date", phrase: "תעבירי את התור של שרית בשלוש", expect: { intent: "move_appointment", customerName: "שרית", missing: ["date"] } },

  // ---- missing time (6) ----
  { id: "MT01", category: "missing_time", phrase: "תקבעי תור לשרית מחר", expect: { intent: "create_appointment", customerName: "שרית", missing: ["time"], clarify: true } },
  { id: "MT02", category: "missing_time", phrase: "תעבירי את התור של שרית למחר", expect: { intent: "move_appointment", customerName: "שרית", missing: ["time"] } },
  { id: "MT03", category: "missing_time", phrase: "תדחי את התור של דני ליום שני", expect: { intent: "move_appointment", customerName: "דני", missing: ["time"] } },
  { id: "MT04", category: "missing_time", phrase: "תכניסי לשרית מחר", expect: { intent: "create_appointment", customerName: "שרית", missing: ["time"], clarify: true } },
  { id: "MT05", category: "missing_time", phrase: "שימי לי תור לדני מחר", expect: { intent: "create_appointment", customerName: "דני", missing: ["time"], clarify: true } },
  { id: "MT06", category: "missing_time", phrase: "תזיזי את התור של שרית ליום שני", expect: { intent: "move_appointment", customerName: "שרית", missing: ["time"] } },

  // ---- unclear (5) ----
  { id: "U01", category: "unclear", phrase: "מה שלומך היום?", expect: { intent: "unknown" } },
  { id: "U02", category: "unclear", phrase: "תודה רבה", expect: { intent: "unknown" } },
  { id: "U03", category: "unclear", phrase: "כמה עולה שירות?", expect: { intent: "unknown" } },
  { id: "U04", category: "unclear", phrase: "תראי לי חשבונית", expect: { intent: "unknown" } },
  { id: "U05", category: "unclear", phrase: "בוקר טוב", expect: { intent: "unknown" } },

  // ---- voice-like corrupted (5) ----
  { id: "V01", category: "voice_corrupted", phrase: "תקווה תור לשרית מחר ב-3", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "V02", category: "voice_corrupted", phrase: "תקווי תור לשרית מחר בשלוש", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "V03", category: "voice_corrupted", phrase: "תור לשרית מחר ב 3", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "V04", category: "voice_corrupted", phrase: "תקבעי תור לשרית מחר ב שלוש", expect: { intent: "create_appointment", customerName: "שרית", time: "15:00", book: true } },
  { id: "V05", category: "voice_corrupted", phrase: "תעבירי תור של שרית למחר בארבע", expect: { intent: "move_appointment", customerName: "שרית", dayReference: "מחר", time: "16:00", reschedule: true } },
];

function runParserCase(item: QaCase): void {
  if (item.expect.intent === "availability") {
    const avail = parseAvailabilityIntent(item.phrase);
    assert.notEqual(avail.kind, "none", `${item.id}: expected availability intent`);
    return;
  }

  const parsed = parseCalendarIntent(item.phrase, OPTS);
  assert.equal(parsed.intent, item.expect.intent, `${item.id} intent`);

  if (item.expect.customerName !== undefined) {
    assert.equal(parsed.customerName, item.expect.customerName, `${item.id} customerName`);
  }
  if (item.expect.dayReference !== undefined) {
    assert.equal(parsed.dayReference, item.expect.dayReference, `${item.id} dayReference`);
  }
  if (item.expect.time !== undefined) {
    assert.equal(parsed.time, item.expect.time, `${item.id} time`);
  }
  if (item.expect.rangeType !== undefined) {
    assert.equal(parsed.rangeType, item.expect.rangeType, `${item.id} rangeType`);
  }
  if (item.expect.missing) {
    for (const field of item.expect.missing) {
      assert.ok(parsed.missingFields.includes(field), `${item.id} missing ${field}`);
    }
  }
  if (item.expect.book) {
    const res = buildCreateAppointmentResponse(parsed);
    assert.ok(res && "action" in res && res.action === "book_appointment", `${item.id} book`);
    assert.match(res!.answer ?? "", /לאשר\?/, `${item.id} confirmation`);
  }
  if (item.expect.clarify) {
    const res = buildCreateAppointmentResponse(parsed);
    assert.ok(res && !("action" in res), `${item.id} clarify not book`);
    assert.ok((res?.answer?.length ?? 0) > 0, `${item.id} clarify answer`);
  }
  if (item.expect.reschedule) {
    const res = extractRescheduleAppointment(item.phrase);
    assert.ok(res, `${item.id} reschedule extract`);
    if (item.expect.customerName) {
      assert.equal(res!.clientName, item.expect.customerName, `${item.id} reschedule name`);
    }
    if (item.expect.time) {
      assert.equal(res!.time, item.expect.time, `${item.id} reschedule time`);
    }
  }
}

test("Hebrew calendar QA matrix: 100 phrases", () => {
  assert.equal(QA_MATRIX.length, 100);
  const failures: string[] = [];
  for (const item of QA_MATRIX) {
    try {
      runParserCase(item);
    } catch (err) {
      failures.push(`${item.id} [${item.category}] "${item.phrase}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length > 0) {
    assert.fail(`QA matrix failures (${failures.length}/100):\n${failures.join("\n")}`);
  }
});

test("calendarMessages templates stay short and clean", () => {
  assert.match(calendarMessages.createConfirmation("שרית", "מחר", "15:00"), /לאשר\?/);
  assert.match(calendarMessages.rescheduleBadDatetime(), /יום ושעה/);
  assert.doesNotMatch(calendarMessages.rescheduleBadDatetime(), /למשל|10:00|14:30/);
  assert.match(calendarMessages.cancelMissingCustomer(), /למי לבטל/);
  assert.equal(calendarMessages.listHeaderDay("מחר"), "התורים שלך למחר:");
});
