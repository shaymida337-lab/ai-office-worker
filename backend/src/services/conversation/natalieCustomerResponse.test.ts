import assert from "node:assert/strict";
import test from "node:test";
import {
  FORBIDDEN_CUSTOMER_OUTPUT_STRINGS,
  findForbiddenCustomerOutput,
  sanitizeNatalieCustomerResponse,
  sanitizeNatalieCustomerResponseOrFallback,
} from "./natalieCustomerResponse.js";

const ACTION_LEAD = /^(בדקתי|מצאתי|עדכנתי|שלחתי|קבעתי|ביטלתי|העברתי|הוספתי|הכנתי|סיימתי|לא הצלחתי|הבנתי)/u;

const SANITIZER_FIXTURES: Array<{ input: string; label: string }> = [
  {
    label: "calendar provenance",
    input: "מקור נתונים: Google Calendar אומת בהצלחה (תמונה מלאה).",
  },
  {
    label: "calendar sync english",
    input: "Google Calendar synchronized successfully. אין פגישות.",
  },
  {
    label: "crm gmail source",
    input: "Source: CRM — מצאתי 5 לקוחות חדשים מ-Gmail.",
  },
  {
    label: "calendar timeout",
    input: "Google Calendar timeout while fetching events",
  },
  {
    label: "process narration",
    input: "התחברתי ליומן ומצאתי 3 פגישות.",
  },
  {
    label: "mail channel suffix",
    input: "מצאתי 5 לקוחות חדשים מהמייל.",
  },
  {
    label: "empty calendar day",
    input: "אין לך פגישות מתוכננות ביומן.",
  },
  {
    label: "api json prompt leak",
    input: 'API error {"JSON":"Prompt"} Database Cache Tool Provider Model',
  },
];

test("sanitizeNatalieCustomerResponse hides calendar provenance jargon", () => {
  assert.equal(
    sanitizeNatalieCustomerResponse(
      "מקור נתונים: Google Calendar אומת בהצלחה (תמונה מלאה).",
    ),
    "",
  );
});

test("sanitizeNatalieCustomerResponse frames bare empty calendar with action lead", () => {
  const out = sanitizeNatalieCustomerResponse(
    "Google Calendar synchronized successfully. אין פגישות.",
  );
  assert.equal(out, "בדקתי את היומן שלך. אין לך פגישות מתוכננות כרגע.");
  assert.match(out, ACTION_LEAD);
});

test("sanitizeNatalieCustomerResponse hides CRM/Gmail and keeps finding without mail source", () => {
  const out = sanitizeNatalieCustomerResponse("Source: CRM — מצאתי 5 לקוחות חדשים מ-Gmail.");
  assert.equal(out, "מצאתי 5 לקוחות חדשים.");
  assert.doesNotMatch(out, /מייל|Gmail|CRM|Source/i);
  assert.match(out, ACTION_LEAD);
});

test("sanitizeNatalieCustomerResponse strips mail channel without exposing מייל", () => {
  const out = sanitizeNatalieCustomerResponse("מצאתי 5 לקוחות חדשים מהמייל.");
  assert.equal(out, "מצאתי 5 לקוחות חדשים.");
  assert.doesNotMatch(out, /מייל/i);
});

test("sanitizeNatalieCustomerResponse humanizes failures without system errors", () => {
  const out = sanitizeNatalieCustomerResponse("Google Calendar timeout while fetching events");
  assert.match(out, /לא הצלחתי לבדוק את היומן כרגע/);
  assert.doesNotMatch(out, /timeout|Google Calendar/i);
  assert.match(out, ACTION_LEAD);
});

test("sanitizeNatalieCustomerResponse rewrites process narration to result verbs", () => {
  const out = sanitizeNatalieCustomerResponse("התחברתי ליומן ומצאתי 3 פגישות.");
  assert.match(out, /בדקתי/);
  assert.doesNotMatch(out, /התחברתי/);
});

test("sanitizeNatalieCustomerResponse prefixes calendar empty lists with בדקתי", () => {
  const out = sanitizeNatalieCustomerResponse("אין לך פגישות מתוכננות ביומן.");
  assert.equal(out, "בדקתי את היומן שלך. אין לך פגישות מתוכננות ביומן.");
  assert.match(out, /^בדקתי/);
});

test("sanitizeNatalieCustomerResponseOrFallback uses friendly empty answer", () => {
  assert.equal(
    sanitizeNatalieCustomerResponseOrFallback("מקור נתונים: Google Calendar"),
    sanitizeNatalieCustomerResponseOrFallback(""),
  );
});

test("forbidden customer output strings never leak through sanitizer fixtures", () => {
  for (const fixture of SANITIZER_FIXTURES) {
    const out = sanitizeNatalieCustomerResponse(fixture.input);
    const hit = findForbiddenCustomerOutput(out);
    assert.equal(hit, null, `${fixture.label}: forbidden "${hit}" in "${out}"`);
    for (const forbidden of FORBIDDEN_CUSTOMER_OUTPUT_STRINGS) {
      if (forbidden === "Source") {
        assert.doesNotMatch(out, /\bsource\b/i, `${fixture.label}: Source leaked`);
      } else {
        assert.ok(!out.includes(forbidden), `${fixture.label}: ${forbidden} leaked in "${out}"`);
      }
    }
  }
});

test("action-bearing sanitizer outputs start with natural lead when framed", () => {
  const framed = [
    sanitizeNatalieCustomerResponse("אין פגישות."),
    sanitizeNatalieCustomerResponse("אין לך פגישות מתוכננות ביומן."),
    sanitizeNatalieCustomerResponse("Source: CRM — מצאתי 5 לקוחות חדשים מ-Gmail."),
  ];
  for (const out of framed) {
    assert.match(out, ACTION_LEAD, `expected action lead in "${out}"`);
  }
});
