import test from "node:test";
import assert from "node:assert/strict";

import {
  assertWorkCaseTransition,
  canTransitionWorkCase,
  getAllowedWorkCaseTransitions,
  isWorkCaseTerminal,
  validateWorkCaseTransition,
  WORK_CASE_TERMINAL_STATUSES,
} from "./workCaseLifecycle.js";
import { LifecycleError } from "./lifecycleErrors.js";

test("open work case can progress or close", () => {
  assert.deepEqual(getAllowedWorkCaseTransitions("open"), ["in_progress", "completed", "cancelled"]);
  assert.equal(canTransitionWorkCase("open", "in_progress"), true);
});

test("terminal work case statuses cannot reopen in V1", () => {
  for (const status of WORK_CASE_TERMINAL_STATUSES) {
    assert.equal(getAllowedWorkCaseTransitions(status).length, 0);
    assert.equal(isWorkCaseTerminal(status), true);
  }

  assert.throws(
    () => assertWorkCaseTransition("completed", "open"),
    (err: unknown) => err instanceof LifecycleError && err.code === "INVALID_TRANSITION"
  );
});

test("complete requires no open events or tasks unless manual close override", () => {
  assert.throws(
    () =>
      validateWorkCaseTransition("open", "completed", {
        openCalendarEventCount: 1,
        openTaskCount: 0,
      }),
    (err: unknown) => err instanceof LifecycleError && err.code === "VALIDATION_FAILED"
  );

  assert.throws(
    () =>
      validateWorkCaseTransition("in_progress", "completed", {
        openCalendarEventCount: 0,
        openTaskCount: 2,
      }),
    (err: unknown) => err instanceof LifecycleError && err.code === "VALIDATION_FAILED"
  );

  assert.doesNotThrow(() =>
    validateWorkCaseTransition("open", "completed", {
      openCalendarEventCount: 0,
      openTaskCount: 0,
    })
  );

  assert.doesNotThrow(() =>
    validateWorkCaseTransition("open", "completed", {
      openCalendarEventCount: 3,
      allowManualClose: true,
    })
  );
});
