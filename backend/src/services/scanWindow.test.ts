import test from "node:test";
import assert from "node:assert/strict";
import { initialConnectScanWindow, startOfCurrentMonth } from "./scanWindow.js";

test("initial connect scan starts at first day of current month", () => {
  const now = new Date(2026, 5, 15, 14, 30, 0, 0);
  const window = initialConnectScanWindow(now);

  assert.deepEqual(window.since, new Date(2026, 5, 1, 0, 0, 0, 0));
  assert.equal(window.daysBack, 15);
});

test("start of current month is not a 90 day lookback", () => {
  const now = new Date(2026, 5, 15, 14, 30, 0, 0);
  const ninetyDaysBack = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  assert.notDeepEqual(startOfCurrentMonth(now), ninetyDaysBack);
  assert.deepEqual(startOfCurrentMonth(now), new Date(2026, 5, 1, 0, 0, 0, 0));
});
