import test from "node:test";
import assert from "node:assert/strict";

import {
  assertEnumValue,
  CALENDAR_EVENT_STATUSES,
  COMPLETION_OUTCOMES,
  DECISION_QUEUE_STATUSES,
  DECISION_QUEUE_TYPES,
  DEFAULT_CALENDAR_AUTONOMY_JSON,
  EVENT_SOURCES,
  GOOGLE_SYNC_STATUSES,
  isCalendarEventStatus,
  isCompletionOutcome,
  isDecisionQueueStatus,
  isDecisionQueueType,
  isEventSource,
  isGoogleSyncStatus,
  isTaskCalendarSource,
  isTimelineEntryType,
  isWorkCaseStatus,
  TASK_CALENDAR_SOURCES,
  TIMELINE_ENTRY_TYPES,
  WORK_CASE_STATUSES,
} from "./enums.js";

test("calendar enums contain approved Phase 0 values", () => {
  assert.deepEqual(CALENDAR_EVENT_STATUSES, [
    "draft",
    "pending_readiness",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
    "rescheduled",
  ]);
  assert.equal(EVENT_SOURCES.length, 8);
  assert.equal(DECISION_QUEUE_TYPES.length, 6);
  assert.equal(DECISION_QUEUE_STATUSES.length, 5);
  assert.equal(TIMELINE_ENTRY_TYPES.length, 18);
  assert.equal(WORK_CASE_STATUSES.length, 4);
  assert.equal(COMPLETION_OUTCOMES.length, 5);
  assert.equal(GOOGLE_SYNC_STATUSES.length, 5);
});

test("enum validators accept approved values and reject unknown values", () => {
  assert.equal(isCalendarEventStatus("draft"), true);
  assert.equal(isCalendarEventStatus("bogus"), false);
  assert.equal(isEventSource("migration"), true);
  assert.equal(isDecisionQueueType("override_conflict"), true);
  assert.equal(isDecisionQueueStatus("superseded"), true);
  assert.equal(isTimelineEntryType("natalie_command"), true);
  assert.equal(isWorkCaseStatus("in_progress"), true);
  assert.equal(isCompletionOutcome("no_show"), true);
  assert.equal(isGoogleSyncStatus("deleted"), true);
  assert.equal(isTaskCalendarSource("post_event"), true);
  assert.equal(isTaskCalendarSource("gmail"), false);
});

test("assertEnumValue throws for invalid enum input", () => {
  assert.throws(() => assertEnumValue("CalendarEventStatus", CALENDAR_EVENT_STATUSES, "invalid"), /Invalid CalendarEventStatus/);
});

test("task calendar source values are documented separately from gmail tasks", () => {
  assert.deepEqual(TASK_CALENDAR_SOURCES, ["post_event", "manual", "decision_rejected"]);
});

test("default calendar autonomy JSON matches Phase 0 defaults", () => {
  assert.deepEqual(DEFAULT_CALENDAR_AUTONOMY_JSON, {
    calendarAutonomy: {
      autoConfirmWhenFullyReady: false,
      autoSendFollowUp: false,
      autoSyncGoogleOnConfirm: true,
      autoCreateFollowUpTask: true,
    },
  });
});
