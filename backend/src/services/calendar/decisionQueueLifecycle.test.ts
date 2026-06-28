import test from "node:test";
import assert from "node:assert/strict";

import {
  assertDecisionQueueTransition,
  canTransitionDecisionQueue,
  DECISION_QUEUE_TERMINAL_STATUSES,
  getAllowedDecisionQueueTransitions,
  isDecisionQueueTerminal,
  validateDecisionQueueApprove,
  validateDecisionQueueReject,
  validateDecisionQueueSupersede,
} from "./decisionQueueLifecycle.js";
import { LifecycleError } from "./lifecycleErrors.js";

test("pending decision can resolve to approved, rejected, superseded, or expired", () => {
  assert.deepEqual(getAllowedDecisionQueueTransitions("pending"), [
    "approved",
    "rejected",
    "superseded",
    "expired",
  ]);
});

test("approved decisions cannot return to pending", () => {
  assert.equal(canTransitionDecisionQueue("approved", "pending"), false);
  assert.throws(
    () => assertDecisionQueueTransition("approved", "pending"),
    (err: unknown) => err instanceof LifecycleError && err.code === "INVALID_TRANSITION"
  );
});

test("terminal decision queue statuses have no outbound transitions", () => {
  for (const status of DECISION_QUEUE_TERMINAL_STATUSES) {
    assert.equal(getAllowedDecisionQueueTransitions(status).length, 0);
    assert.equal(isDecisionQueueTerminal(status), true);
  }
});

test("approve rejects stale decisions when calendar event is terminal", () => {
  assert.throws(
    () =>
      validateDecisionQueueApprove("pending", {
        calendarEventStatus: "cancelled",
      }),
    (err: unknown) => err instanceof LifecycleError && err.code === "STALE_DECISION"
  );

  assert.doesNotThrow(() =>
    validateDecisionQueueApprove("pending", {
      calendarEventStatus: "confirmed",
    })
  );

  assert.doesNotThrow(() =>
    validateDecisionQueueApprove("pending", {
      calendarEventStatus: "cancelled",
      alreadyExecuted: true,
    })
  );
});

test("reject and supersede require pending source state", () => {
  assert.doesNotThrow(() => validateDecisionQueueReject("pending"));
  assert.doesNotThrow(() => validateDecisionQueueSupersede("pending"));

  assert.throws(
    () => validateDecisionQueueReject("approved"),
    (err: unknown) => err instanceof LifecycleError && err.code === "INVALID_TRANSITION"
  );
});
