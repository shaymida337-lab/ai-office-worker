import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionAttendance } from "./stateMachine.js";

test("attendance state machine allows valid transitions", () => {
  assert.equal(canTransitionAttendance("scheduled", "reminder_pending"), true);
  assert.equal(canTransitionAttendance("reminder_sent", "confirmed"), true);
  assert.equal(canTransitionAttendance("reminder_sent", "declined"), true);
  assert.equal(canTransitionAttendance("confirmed", "arrived"), true);
});

test("attendance state machine blocks invalid transitions", () => {
  assert.equal(canTransitionAttendance("cancelled", "confirmed"), false);
  assert.equal(canTransitionAttendance("arrived", "cancelled"), false);
  assert.equal(canTransitionAttendance("no_show", "arrived"), false);
});
