import test from "node:test";
import assert from "node:assert/strict";
import { NATALIE_EMPTY_ANSWER } from "./formatResponse";
import { normalizeAvailabilityProposal, normalizeNatalieResponse } from "./responseGuard";

test("normalizeNatalieResponse keeps normal text response", () => {
  const result = normalizeNatalieResponse({ answer: "שלום" });
  assert.equal(result.answer, "שלום");
  assert.equal(result.action, undefined);
});

test("normalizeNatalieResponse falls back on empty/null payload", () => {
  assert.equal(normalizeNatalieResponse(null).answer, NATALIE_EMPTY_ANSWER);
  assert.equal(normalizeNatalieResponse({ answer: "" }).answer, NATALIE_EMPTY_ANSWER);
});

test("normalizeNatalieResponse sanitizes malformed invoices", () => {
  const result = normalizeNatalieResponse({
    action: "show_invoice",
    answer: "מצאתי",
    invoices: [{ id: "i1", amount: "bad" }, { id: "i2", amount: 120, issueDate: "2026-07-02T00:00:00Z" }],
  });
  assert.equal(result.invoices?.length, 2);
  assert.equal(result.invoices?.[0]?.amount, 0);
  assert.equal(result.invoices?.[1]?.amount, 120);
});

test("normalizeAvailabilityProposal tolerates unknown widget/action shape", () => {
  const normalized = normalizeAvailabilityProposal({
    slots: [{ startTime: "2026-07-03T10:00:00Z", endTime: "2026-07-03T10:30:00Z", label: "10:00", durationMinutes: 30 }, { bad: true }],
  });
  assert.equal(Array.isArray(normalized?.slots), true);
  assert.equal((normalized?.slots as unknown[]).length, 1);
});

test("normalizeNatalieResponse handles Hebrew and long answer", () => {
  const longHebrew = "שלום ".repeat(300);
  const result = normalizeNatalieResponse({ answer: longHebrew });
  assert.ok(result.answer.includes("שלום"));
});

