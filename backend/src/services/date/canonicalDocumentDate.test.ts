import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCanonicalDocumentDate,
  normalizeRawDateToIso,
  isValidCalendarDateString,
  DateCandidate,
} from "./canonicalDocumentDate.js";

test("1. Explicit invoice issue date resolves correctly", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "2026-06-15",
      normalizedValue: "2026-06-15",
      source: "pdf_text",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2026-06-15");
  assert.equal(decision.reasonCode, "RESOLVED_EXPLICIT_DOCUMENT_DATE");
});

test("2. Missing issue date returns null and MISSING_DATE", () => {
  const candidates: DateCandidate[] = [];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "missing");
  assert.equal(decision.value, null);
  assert.equal(decision.reasonCode, "MISSING_DATE");
});

test("3 & 4. Transport metadata (emailReceivedAt, createdAt) cannot resolve issueDate", () => {
  // Transport metadata is excluded from DateCandidates for issue_date
  const transportReceivedAt = "2026-08-10T12:00:00Z";
  const candidates: DateCandidate[] = []; // No document-face candidates
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.value, null);
  assert.equal(decision.status, "missing");
  assert.notEqual(decision.value, transportReceivedAt.slice(0, 10));
});

test("5. Historical 2023 invoice scanned today retains 2023 issueDate", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "2023-04-12",
      normalizedValue: "2023-04-12",
      source: "pdf_text",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "resolved");
  assert.equal(decision.value, "2023-04-12");
});

test("6. Due date only leaves issueDate null while resolving dueDate", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "due_date",
      rawText: "2026-07-30",
      normalizedValue: "2026-07-30",
      source: "pdf_text",
    },
  ];
  const issueDecision = resolveCanonicalDocumentDate(candidates, "issue_date");
  const dueDecision = resolveCanonicalDocumentDate(candidates, "due_date");

  assert.equal(issueDecision.value, null);
  assert.equal(issueDecision.status, "missing");
  assert.equal(dueDecision.value, "2026-07-30");
  assert.equal(dueDecision.status, "resolved");
});

test("7. Issue date and due date are preserved separately", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "2026-06-01",
      normalizedValue: "2026-06-01",
      source: "pdf_text",
    },
    {
      semanticType: "due_date",
      rawText: "2026-06-30",
      normalizedValue: "2026-06-30",
      source: "pdf_text",
    },
  ];
  const issueDecision = resolveCanonicalDocumentDate(candidates, "issue_date");
  const dueDecision = resolveCanonicalDocumentDate(candidates, "due_date");

  assert.equal(issueDecision.value, "2026-06-01");
  assert.equal(dueDecision.value, "2026-06-30");
});

test("8. Service date only leaves issueDate null", () => {
  const candidates: DateCandidate[] = [
    {
      semanticType: "service_date",
      rawText: "2026-05-01",
      normalizedValue: "2026-05-01",
      source: "pdf_text",
    },
  ];
  const issueDecision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(issueDecision.value, null);
  assert.equal(issueDecision.status, "missing");
});

test("9. Ambiguous numeric date (03/04/2026) flags ambiguity", () => {
  const parsed = normalizeRawDateToIso("03/04/2026");
  assert.equal(parsed.isAmbiguous, true);
  assert.equal(parsed.normalized, "2026-04-03"); // Israeli DD/MM default
});

test("10 & 11. Hebrew and English date strings parse correctly", () => {
  const hebrewParsed = normalizeRawDateToIso("15/06/2026");
  assert.equal(hebrewParsed.normalized, "2026-06-15");
  assert.equal(hebrewParsed.isAmbiguous, false);

  const isoParsed = normalizeRawDateToIso("2026-06-15");
  assert.equal(isoParsed.normalized, "2026-06-15");
});

test("12. Impossible calendar date returns invalid", () => {
  assert.equal(isValidCalendarDateString("2026-02-30"), false);
  const candidates: DateCandidate[] = [
    {
      semanticType: "issue_date",
      rawText: "2026-02-30",
      normalizedValue: null,
      source: "pdf_text",
    },
  ];
  const decision = resolveCanonicalDocumentDate(candidates, "issue_date");
  assert.equal(decision.status, "invalid");
  assert.equal(decision.value, null);
});

test("13. Historical invoice in valid year range (1990-2099) is valid", () => {
  assert.equal(isValidCalendarDateString("2015-11-20"), true);
  assert.equal(isValidCalendarDateString("1850-01-01"), false);
});
