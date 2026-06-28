import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCalendarEventTransition,
  CALENDAR_EVENT_TERMINAL_STATUSES,
  canTransitionCalendarEvent,
  getAllowedCalendarEventTransitions,
  isCalendarEventTerminal,
  validateCalendarEventTransition,
} from "./calendarEventLifecycle.js";
import { LifecycleError } from "./lifecycleErrors.js";

test("draft can move to pending_readiness or cancelled only", () => {
  assert.deepEqual(getAllowedCalendarEventTransitions("draft"), ["pending_readiness", "cancelled"]);
  assert.equal(canTransitionCalendarEvent("draft", "confirmed"), false);
});

test("forbidden direct draft to confirmed transition", () => {
  assert.throws(
    () => assertCalendarEventTransition("draft", "confirmed"),
    (err: unknown) => err instanceof LifecycleError && err.code === "INVALID_TRANSITION"
  );
});

test("confirmed can reach terminal outcomes", () => {
  for (const status of ["completed", "no_show", "cancelled", "rescheduled"] as const) {
    assert.equal(canTransitionCalendarEvent("confirmed", status), true);
  }
});

test("terminal calendar event statuses have no outbound transitions", () => {
  for (const status of CALENDAR_EVENT_TERMINAL_STATUSES) {
    assert.equal(getAllowedCalendarEventTransitions(status).length, 0);
    assert.equal(isCalendarEventTerminal(status), true);
  }
});

test("in_progress is reserved with no V1 transitions", () => {
  assert.deepEqual(getAllowedCalendarEventTransitions("in_progress"), []);
});

test("pending_readiness validation requires startAt, workCaseId, and client for appointments", () => {
  assert.throws(
    () => validateCalendarEventTransition("draft", "pending_readiness", { eventType: "appointment" }),
    (err: unknown) => err instanceof LifecycleError && err.code === "VALIDATION_FAILED"
  );

  assert.doesNotThrow(() =>
    validateCalendarEventTransition("draft", "pending_readiness", {
      startAt: new Date("2026-06-25T10:00:00.000Z"),
      workCaseId: "wc_1",
      clientId: "client_1",
      eventType: "appointment",
    })
  );
});

test("complete requires notes, outcome, and confirmed source state", () => {
  const startAt = new Date("2026-06-20T10:00:00.000Z");
  assert.throws(
    () =>
      validateCalendarEventTransition("confirmed", "completed", {
        now: new Date("2026-06-20T11:00:00.000Z"),
        startAt,
      }),
    (err: unknown) => err instanceof LifecycleError && err.code === "VALIDATION_FAILED"
  );

  assert.doesNotThrow(() =>
    validateCalendarEventTransition("confirmed", "completed", {
      now: new Date("2026-06-20T11:00:00.000Z"),
      startAt,
      completionNotes: "Done",
      completionOutcome: "completed_success",
    })
  );
});

test("no_show requires confirmed state and grace after start", () => {
  const startAt = new Date("2026-06-20T10:00:00.000Z");
  assert.throws(
    () =>
      validateCalendarEventTransition("confirmed", "no_show", {
        now: new Date("2026-06-20T09:59:00.000Z"),
        startAt,
      }),
    (err: unknown) => err instanceof LifecycleError && err.code === "VALIDATION_FAILED"
  );

  assert.doesNotThrow(() =>
    validateCalendarEventTransition("confirmed", "no_show", {
      now: new Date("2026-06-20T10:15:00.000Z"),
      startAt,
      noShowGraceMinutes: 10,
    })
  );
});
