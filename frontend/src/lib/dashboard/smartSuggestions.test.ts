import assert from "node:assert/strict";
import test from "node:test";
import { buildSmartSuggestions, isMonthEndApproaching } from "./smartSuggestions";

test("buildSmartSuggestions prioritizes Gmail connect when disconnected", () => {
  const suggestions = buildSmartSuggestions({ gmailConnected: false });
  assert.equal(suggestions[0], "חבר את Gmail");
});

test("buildSmartSuggestions adds accountant prep near month end", () => {
  const suggestions = buildSmartSuggestions({
    gmailConnected: true,
    monthEndApproaching: true,
  });
  assert.ok(suggestions.includes("הכן חודש לרואה החשבון"));
});

test("isMonthEndApproaching is true in last days of month", () => {
  assert.equal(isMonthEndApproaching(new Date("2026-07-29T12:00:00")), true);
});
