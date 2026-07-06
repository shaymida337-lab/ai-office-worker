import assert from "node:assert/strict";
import test from "node:test";

test("calendar page follows Phase A visible layout rhythm", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/app/dashboard/calendar/page.tsx", "utf8");

  const briefIndex = source.indexOf("<NatalieCalendarDailyBrief");
  const toolbarIndex = source.indexOf("<CalendarToolbar");
  const monthIndex = source.indexOf("<MonthCalendarView");
  const actionIndex = source.indexOf("<NatalieCalendarActionCenter");
  const requestIndex = source.indexOf("<NatalieRequestButton");

  assert.ok(briefIndex >= 0, "daily brief present");
  assert.ok(toolbarIndex > briefIndex, "toolbar follows brief");
  assert.ok(monthIndex > toolbarIndex, "month view present");
  assert.ok(actionIndex > briefIndex, "action center present");
  assert.ok(requestIndex > briefIndex, "natalie request button present");
  assert.match(source, /<CalendarToolbar/);
  assert.match(source, /data-testid="calendar-page"/);
});
