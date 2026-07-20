import test from "node:test";
import assert from "node:assert/strict";
import {
  formatNatalieResponse,
  formatNatalieResponseOrFallback,
  FORBIDDEN_CUSTOMER_OUTPUT_STRINGS,
  findForbiddenCustomerOutput,
  NATALIE_EMPTY_ANSWER,
} from "./formatResponse.js";

const ACTION_LEAD = /^(בדקתי|מצאתי|עדכנתי|שלחתי|קבעתי|ביטלתי|העברתי|הוספתי|הכנתי|סיימתי|לא הצלחתי|הבנתי)/u;

const SANITIZER_FIXTURES = [
  "מקור נתונים: Google Calendar אומת בהצלחה (תמונה מלאה). אין פגישות.",
  "Source: CRM — מצאתי 5 לקוחות חדשים מ-Gmail.",
  "מצאתי 5 לקוחות חדשים מהמייל.",
  'API error {"JSON":"Prompt"} Database Cache Tool Provider Model',
];

test("formatNatalieResponse: strips bold and underline markdown", () => {
  assert.equal(formatNatalieResponse("יש **חשבונית** אחת ו__עוד__ משימה"), "יש חשבונית אחת ועוד משימה");
});

test("formatNatalieResponse: strips headers and horizontal rules", () => {
  const input = "### סיכום\n---\n# כותרת\nטקסט רגיל";
  const out = formatNatalieResponse(input);
  assert.match(out, /סיכום/);
  assert.match(out, /כותרת/);
  assert.match(out, /טקסט רגיל/);
  assert.doesNotMatch(out, /---/);
  assert.doesNotMatch(out, /###/);
});

test("formatNatalieResponse: replaces internal status codes", () => {
  assert.match(formatNatalieResponse("החשבונית ב-needs_review"), /דורש בדיקה/);
  assert.match(formatNatalieResponse("סטטוס: approved"), /מאושר/);
  assert.match(formatNatalieResponse("pending_review"), /ממתין לבדיקה/);
});

test("formatNatalieResponse: enum translation", () => {
  assert.match(formatNatalieResponse("status: paid"), /שולם/);
  assert.match(formatNatalieResponse("status: unpaid"), /לא שולם/);
  assert.match(formatNatalieResponse("payment is overdue"), /באיחור/);
  assert.match(formatNatalieResponse("saved as draft"), /טיוטה/);
  assert.match(formatNatalieResponse("appointment cancelled"), /בוטל/);
  assert.match(formatNatalieResponse("task completed"), /הושלם/);
  assert.match(formatNatalieResponse("upload failed"), /נכשל/);
  assert.match(formatNatalieResponse("still processing"), /בעיבוד/);
  assert.match(formatNatalieResponse("email scanned"), /נסרק/);
  assert.match(formatNatalieResponse("type: invoice"), /חשבונית/);
  assert.match(formatNatalieResponse("type: receipt"), /קבלה/);
  assert.match(formatNatalieResponse("supplier_payment pending"), /תשלום לספק/);
});

test("formatNatalieResponse: removes JSON fragments", () => {
  const input = 'מצאתי חשבונית {"id":"1","status":"needs_review"} לספק';
  const out = formatNatalieResponse(input);
  assert.doesNotMatch(out, /\{/);
  assert.doesNotMatch(out, /needs_review/);
  assert.match(out, /מצאתי חשבונית/);
});

test("formatNatalieResponse: extracts answer from leaked JSON wrapper", () => {
  const input = '{"answer":"**שלום**, הכל בסדר"}';
  assert.equal(formatNatalieResponse(input), "שלום, הכל בסדר");
});

test("formatNatalieResponse: removes leaked null and undefined", () => {
  const out = formatNatalieResponse("organizationId: org-1 userId: u-2 documentId null undefined NaN true false");
  assert.doesNotMatch(out, /organizationId/i);
  assert.doesNotMatch(out, /userId/i);
  assert.doesNotMatch(out, /documentId/i);
  assert.doesNotMatch(out, /\bnull\b/i);
  assert.doesNotMatch(out, /\bundefined\b/i);
  assert.doesNotMatch(out, /\bNaN\b/i);
  assert.doesNotMatch(out, /\btrue\b/i);
  assert.doesNotMatch(out, /\bfalse\b/i);
});

test("formatNatalieResponse: preserves natural Hebrew unchanged", () => {
  const natural = "בוקר טוב! מצאתי חשבונית אחת שמחכה לאישור.";
  assert.equal(formatNatalieResponse(natural), natural);
  const calm = "הכל מסודר — אין דבר דחוף כרגע.";
  assert.equal(formatNatalieResponse(calm), calm);
});

test("formatNatalieResponse: preserves amounts and dates", () => {
  const input = "חשבונית מוולט על סך 1,240 ₪ מתאריך 15.06.2026, סטטוס unpaid, #INV-778";
  const out = formatNatalieResponse(input);
  assert.match(out, /1,240 ₪/);
  assert.match(out, /15\.06\.2026/);
  assert.match(out, /#INV-778/);
  assert.match(out, /לא שולם/);
  assert.match(out, /וולט/);
});

test("formatNatalieResponse: converts leaked table to Hebrew lines", () => {
  const input = [
    "הנה הפירוט:",
    "| ספק | סכום |",
    "| --- | --- |",
    "| וולט | 120 ₪ |",
    "| בזק | 89 ₪ |",
  ].join("\n");
  const out = formatNatalieResponse(input);
  assert.match(out, /ספק: וולט/);
  assert.match(out, /120 ₪/);
  assert.match(out, /ספק: בזק/);
  assert.match(out, /89 ₪/);
  assert.doesNotMatch(out, /\|---\|/);
});

test("formatNatalieResponse: limits long answers to five lines", () => {
  const input = [
    "הנה סיכום קצר.",
    "שורה 1",
    "שורה 2",
    "שורה 3",
    "שורה 4",
    "שורה 5",
    "שורה 6",
    "שורה 7",
  ].join("\n");
  const out = formatNatalieResponse(input);
  assert.equal(out.split("\n").length, 5);
  assert.match(out, /^הנה סיכום קצר\./);
});

test("formatNatalieResponse: normalizes bullet syntax", () => {
  const input = "- חשבונית אחת\n* משימה שנייה\n• תשלום";
  assert.equal(formatNatalieResponse(input), "חשבונית אחת\nמשימה שנייה\nתשלום");
});

test("formatNatalieResponse: replaces technical phrasing", () => {
  const out = formatNatalieResponse("לא מצאתי תשובה לפי הנתונים הקיימים כרגע.");
  assert.doesNotMatch(out, /לפי הנתונים/);
  assert.match(out, /לא מצאתי/);
});

test("formatNatalieResponseOrFallback: uses friendly empty answer", () => {
  assert.equal(formatNatalieResponseOrFallback(""), NATALIE_EMPTY_ANSWER);
  assert.equal(formatNatalieResponseOrFallback('{"status":"approved"}'), NATALIE_EMPTY_ANSWER);
});

test("formatNatalieResponse: hides calendar provenance and frames empty calendar", () => {
  const out = formatNatalieResponse(
    "מקור נתונים: Google Calendar אומת בהצלחה (תמונה מלאה). אין פגישות.",
  );
  assert.equal(out, "בדקתי את היומן שלך. אין לך פגישות מתוכננות כרגע.");
  assert.doesNotMatch(out, /Google Calendar|מקור נתונים|תמונה מלאה/i);
  assert.match(out, ACTION_LEAD);
});

test("formatNatalieResponse: strips CRM/Gmail/mail without exposing מייל", () => {
  const out = formatNatalieResponse("Source: CRM — מצאתי 5 לקוחות חדשים מ-Gmail.");
  assert.equal(out, "מצאתי 5 לקוחות חדשים.");
  assert.doesNotMatch(out, /CRM|Gmail|Source|מייל/i);
  assert.match(out, ACTION_LEAD);
});

test("formatNatalieResponse: forbidden customer strings never leak", () => {
  for (const input of SANITIZER_FIXTURES) {
    const out = formatNatalieResponse(input);
    const hit = findForbiddenCustomerOutput(out);
    assert.equal(hit, null, `forbidden "${hit}" in "${out}" from "${input}"`);
    for (const forbidden of FORBIDDEN_CUSTOMER_OUTPUT_STRINGS) {
      if (forbidden === "Source") {
        assert.doesNotMatch(out, /\bsource\b/i);
      } else {
        assert.ok(!out.includes(forbidden), `${forbidden} leaked in "${out}"`);
      }
    }
  }
});
