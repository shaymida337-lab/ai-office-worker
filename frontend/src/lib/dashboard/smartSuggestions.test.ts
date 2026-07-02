import assert from "node:assert/strict";
import test from "node:test";
import { buildSmartSuggestions, isMonthEndApproaching } from "./smartSuggestions";

test("buildSmartSuggestions prioritizes Gmail connect when disconnected", () => {
  const suggestions = buildSmartSuggestions({ gmailConnectionPhase: "disconnected" });
  assert.equal(suggestions[0], "חבר את Gmail");
});

test("buildSmartSuggestions does not suggest Gmail connect when evidence is ambiguous", () => {
  const suggestions = buildSmartSuggestions({ gmailConnectionPhase: "evidence_ambiguous" });
  assert.ok(!suggestions.includes("חבר את Gmail"));
});

test("buildSmartSuggestions does not suggest Gmail connect when status is unknown", () => {
  const suggestions = buildSmartSuggestions({ gmailConnectionPhase: "unknown" });
  assert.ok(!suggestions.includes("חבר את Gmail"));
});

test("buildSmartSuggestions adds accountant prep near month end", () => {
  const suggestions = buildSmartSuggestions({
    gmailConnected: true,
    monthEndApproaching: true,
  });
  assert.ok(suggestions.includes("הכן חודש לרואה החשבון"));
});

test("buildSmartSuggestions keeps connected scan action when email missing but connected", () => {
  const suggestions = buildSmartSuggestions({ gmailConnectionPhase: "connected" });
  assert.ok(suggestions.includes("סרקי את Gmail"));
  assert.ok(!suggestions.includes("חבר את Gmail"));
});

test("isMonthEndApproaching is true in last days of month", () => {
  assert.equal(isMonthEndApproaching(new Date("2026-07-29T12:00:00")), true);
});
