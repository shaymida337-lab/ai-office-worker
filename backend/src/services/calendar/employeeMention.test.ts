import test from "node:test";
import assert from "node:assert/strict";
import { extractEmployeeMention, parseCalendarIntent } from "./calendarIntentParser.js";
import { matchEmployeesByName } from "../employees/employeeNameMatch.js";
import { resolveEmployeeMentionForBooking } from "../natalie.js";

const TZ = "Asia/Jerusalem";
const EMPLOYEES = [
  { id: "emp-yossi", name: "יוסי" },
  { id: "emp-dana", name: "דנה" },
  { id: "emp-arik", name: "אריק" },
];

test("חילוץ אזכור עובד: 'תקבעי לרות אצל יוסי ביום שלישי ב-10'", () => {
  const mention = extractEmployeeMention("תקבעי לרות אצל יוסי ביום שלישי ב-10");
  assert.ok(mention);
  assert.equal(mention!.name, "יוסי");
  assert.equal(mention!.marker, "etzel");
  assert.equal(mention!.textWithoutMention, "תקבעי לרות ביום שלישי ב-10");
});

test("חילוץ אזכור עובד: 'קבעי תור אצל אריק מחר ב-4'", () => {
  const mention = extractEmployeeMention("קבעי תור אצל אריק מחר ב-4");
  assert.ok(mention);
  assert.equal(mention!.name, "אריק");
  assert.equal(mention!.marker, "etzel");
  assert.equal(mention!.textWithoutMention, "קבעי תור מחר ב-4");
});

test("חילוץ אזכור עובד: 'תקבעי עם דנה' — סמן 'עם'", () => {
  const mention = extractEmployeeMention("תקבעי עם דנה");
  assert.ok(mention);
  assert.equal(mention!.name, "דנה");
  assert.equal(mention!.marker, "im");
});

test("בלי אזכור עובד — אין חילוץ, ו'אצל עצמי' לא נחשב", () => {
  assert.equal(extractEmployeeMention("תקבעי תור לרות מחר ב-10"), null);
  assert.equal(extractEmployeeMention("קבעי תור אצל עצמי מחר"), null);
});

test("אחרי הסרת האזכור — הלקוח, היום והשעה נחלצים נקיים", () => {
  const mention = extractEmployeeMention("תקבעי לרות אצל יוסי ביום שלישי ב-10");
  const extraction = parseCalendarIntent(mention!.textWithoutMention, {
    timeZone: TZ,
    now: new Date(Date.UTC(2026, 6, 13, 9, 0)),
  });
  assert.equal(extraction.intent, "create_appointment");
  assert.equal(extraction.customerName, "רות");
  assert.ok(extraction.dayReference?.includes("שלישי"));
  assert.equal(extraction.time, "10:00");
});

test("התאמת שם עובד: מדויק גובר, מילה שלמה, תחילית, ריבוי התאמות", () => {
  const staff = [
    { id: "a", name: "יוסי" },
    { id: "b", name: "יוסי לוי" },
    { id: "c", name: "יוספה" },
  ];
  assert.deepEqual(matchEmployeesByName(staff, "יוסי").map((employee) => employee.id), ["a"]);
  assert.deepEqual(matchEmployeesByName(staff, "לוי").map((employee) => employee.id), ["b"]);
  assert.deepEqual(matchEmployeesByName(staff, "יוספ").map((employee) => employee.id), ["c"]);
  assert.deepEqual(matchEmployeesByName(staff, "משה"), []);
  const twoDanas = [
    { id: "d1", name: "דנה לוי" },
    { id: "d2", name: "דנה כהן" },
  ];
  assert.equal(matchEmployeesByName(twoDanas, "דנה").length, 2, "שתי דנה — ריבוי התאמות");
});

test("הכרעה: התאמה אחת מוסיפה את העובד ומנקה את השאלה", () => {
  const resolution = resolveEmployeeMentionForBooking({
    question: "תקבעי לרות אצל יוסי ביום שלישי ב-10",
    activeEmployees: EMPLOYEES,
  });
  assert.equal(resolution.kind, "matched");
  assert.equal(resolution.kind === "matched" && resolution.employee.id, "emp-yossi");
  assert.equal(
    resolution.kind === "matched" && resolution.effectiveQuestion,
    "תקבעי לרות ביום שלישי ב-10"
  );
});

test("הכרעה: 'אצל' בלי עובד תואם — שואלים אצל איזה עובד עם רשימת הפעילים", () => {
  const resolution = resolveEmployeeMentionForBooking({
    question: "קבעי תור אצל משה מחר ב-11",
    activeEmployees: EMPLOYEES,
  });
  assert.equal(resolution.kind, "clarify");
  const answer = resolution.kind === "clarify" ? resolution.answer : "";
  assert.ok(answer.includes("לא מצאתי עובד פעיל בשם \"משה\""), answer);
  assert.ok(answer.includes("יוסי") && answer.includes("דנה") && answer.includes("אריק"), answer);
});

test("הכרעה: כמה עובדים עם שם דומה — מבקשים הבהרה", () => {
  const resolution = resolveEmployeeMentionForBooking({
    question: "קבעי תור אצל דנה מחר ב-11",
    activeEmployees: [
      { id: "d1", name: "דנה לוי" },
      { id: "d2", name: "דנה כהן" },
    ],
  });
  assert.equal(resolution.kind, "clarify");
  const answer = resolution.kind === "clarify" ? resolution.answer : "";
  assert.ok(answer.includes("דנה לוי") && answer.includes("דנה כהן"), answer);
  assert.ok(answer.includes("אצל איזה עובד"), answer);
});

test("הכרעה: ארגון בלי עובדים פעילים — 'אצל' נשאר בהתנהגות הישנה (לקוח)", () => {
  const resolution = resolveEmployeeMentionForBooking({
    question: "קבעי תור אצל אריק מחר ב-16:00",
    activeEmployees: [],
  });
  assert.deepEqual(resolution, { kind: "none" });
});

test("הכרעה: 'עם רונן' כשרונן אינו עובד — נשאר לקוח, בלי שאלת עובד", () => {
  const resolution = resolveEmployeeMentionForBooking({
    question: "תקבעי פגישה עם רונן מחר ב-14:00",
    activeEmployees: EMPLOYEES,
  });
  assert.deepEqual(resolution, { kind: "none" });
});

test("הכרעה: 'תקבעי עם דנה' כשדנה עובדת — העובדת מזוהה", () => {
  const resolution = resolveEmployeeMentionForBooking({
    question: "תקבעי עם דנה",
    activeEmployees: EMPLOYEES,
  });
  assert.equal(resolution.kind, "matched");
  assert.equal(resolution.kind === "matched" && resolution.employee.id, "emp-dana");
});
