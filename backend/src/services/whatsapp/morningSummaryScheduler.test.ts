import assert from "node:assert/strict";
import { test } from "node:test";
import { wallClockToDate } from "../calendar/datetime.js";
import {
  evaluateMorningSummarySend,
  getLocalDayKey,
  isHardBlockedLocalTime,
  isInMorningSendWindow,
  MORNING_SUMMARY_CRON_EXPRESSION,
  MORNING_SUMMARY_TIMEZONE,
} from "./morningSummaryScheduler.js";

const TZ = MORNING_SUMMARY_TIMEZONE;

function israelTime(year: number, month: number, day: number, hour: number, minute = 0): Date {
  const date = wallClockToDate(year, month, day, hour, minute, TZ);
  if (!date) throw new Error(`Failed to build Israel time ${year}-${month}-${day} ${hour}:${minute}`);
  return date;
}

test("cron expression is 08:00 Asia/Jerusalem Sunday-Friday", () => {
  assert.equal(MORNING_SUMMARY_CRON_EXPRESSION, "0 8 * * 0-5");
  assert.equal(MORNING_SUMMARY_TIMEZONE, "Asia/Jerusalem");
});

test("hard night block rejects 22:00 through 06:59 local", () => {
  assert.equal(isHardBlockedLocalTime(22), true);
  assert.equal(isHardBlockedLocalTime(2), true);
  assert.equal(isHardBlockedLocalTime(6), true);
  assert.equal(isHardBlockedLocalTime(7), false);
  assert.equal(isHardBlockedLocalTime(21), false);
});

test("send window is 08:00 inclusive through 08:59 local", () => {
  assert.equal(isInMorningSendWindow(7, 59), false);
  assert.equal(isInMorningSendWindow(8, 0), true);
  assert.equal(isInMorningSendWindow(8, 30), true);
  assert.equal(isInMorningSendWindow(8, 59), true);
  assert.equal(isInMorningSendWindow(9, 0), false);
});

test("restart at 02:00 Israel summer (UTC+3 server) is blocked", () => {
  const now = israelTime(2026, 7, 7, 2, 2);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "cron_scheduler_owner",
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "hard_night_block_22_to_07");
});

test("restart at 02:00 Israel winter (UTC+2 server) is blocked", () => {
  const now = israelTime(2026, 1, 7, 2, 0);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "cron_worker",
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "hard_night_block_22_to_07");
});

test("restart at 06:30 Israel waits until 08:00 window", () => {
  const now = israelTime(2026, 7, 7, 6, 30);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "cron_external",
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "hard_night_block_22_to_07");
});

test("restart at 07:30 Israel waits until 08:00 window", () => {
  const now = israelTime(2026, 7, 7, 7, 30);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "cron_scheduler_owner",
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "before_send_window_wait_until_08");
});

test("restart at 08:30 Israel sends inside morning window", () => {
  const now = israelTime(2026, 7, 7, 8, 30);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "cron_scheduler_owner",
  });
  assert.equal(decision.action, "send");
  assert.match(decision.reason, /in_send_window/);
});

test("missed window at 10:00 Israel does not send immediately", () => {
  const now = israelTime(2026, 7, 7, 10, 0);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "send_daily_summary",
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "after_send_window_wait_until_tomorrow");
});

test("duplicate prevention skips second send same local day", () => {
  const now = israelTime(2026, 7, 7, 8, 15);
  const decision = evaluateMorningSummarySend({
    now,
    timeZone: TZ,
    trigger: "cron_worker",
    alreadySentToday: true,
  });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "duplicate_already_sent_today");
});

test("DST summer 08:00 Israel is in send window on UTC server", () => {
  const now = israelTime(2026, 7, 7, 8, 0);
  assert.equal(now.getUTCHours(), 5);
  const decision = evaluateMorningSummarySend({ now, timeZone: TZ, trigger: "cron_worker" });
  assert.equal(decision.action, "send");
});

test("DST winter 08:00 Israel is in send window on UTC server", () => {
  const now = israelTime(2026, 1, 7, 8, 0);
  assert.equal(now.getUTCHours(), 6);
  const decision = evaluateMorningSummarySend({ now, timeZone: TZ, trigger: "cron_worker" });
  assert.equal(decision.action, "send");
});

test("Saturday morning summary is skipped", () => {
  const now = israelTime(2026, 7, 11, 8, 15);
  const decision = evaluateMorningSummarySend({ now, timeZone: TZ, trigger: "cron_worker" });
  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "saturday");
});

test("local day key uses organization timezone not server timezone", () => {
  const lateUtc = new Date("2026-07-06T21:30:00.000Z");
  assert.equal(getLocalDayKey(lateUtc, TZ), "2026-07-07");
  assert.notEqual(getLocalDayKey(lateUtc, "UTC"), getLocalDayKey(lateUtc, TZ));
});
