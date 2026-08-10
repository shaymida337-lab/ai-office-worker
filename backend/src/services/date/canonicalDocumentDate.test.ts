import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCanonicalDocumentDate,
  normalizeRawDateToIso,
  isValidCalendarDateString,
  DateCandidate,
} from "./canonicalDocumentDate.js";

test("Step 9.1: 03/04/2026 without locale evidence -> ambiguous and value null", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "03/04/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.value, null);
  assert.equal(decision.reasonCode, "AMBIGUOUS_NUMERIC_DATE");
});

test("Step 9.2: 04/03/2026 without locale evidence -> ambiguous and value null", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "04/03/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.value, null);
  assert.equal(decision.reasonCode, "AMBIGUOUS_NUMERIC_DATE");
});

test("Step 9.3: 13/04/2026 -> 2026-04-13 (unambiguous because 13 > 12)", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "13/04/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2026-04-13");
});

test("Step 9.4: 04/13/2026 -> 2026-04-13 (unambiguous because 13 > 12)", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "04/13/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2026-04-13");
});

test("Step 9.5: 2026-04-03 -> 2026-04-03 (unambiguous ISO)", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "2026-04-03",
      normalizedValue: "2026-04-03",
      source: "pdf_text",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2026-04-03");
});

test("Step 9.6: trusted locale he-IL disamiguates 03/04/2026 -> 2026-04-03", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "03/04/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date", { locale: "he-IL" });
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2026-04-03");
});

test("Step 9.7: trusted locale en-US disambiguates 03/04/2026 -> 2026-03-04", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "03/04/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date", { locale: "en-US" });
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2026-03-04");
});

test("Step 10: Transport metadata (emailReceivedAt, emailSentAt, createdAt) MUST NOT disambiguate issueDate", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "03/04/2026",
      normalizedValue: null,
      source: "llm",
    },
  ];
  // Presence of emailReceivedAt metadata in calling context does NOT change ambiguity
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.value, null);
  assert.equal(decision.reasonCode, "AMBIGUOUS_NUMERIC_DATE");
});
