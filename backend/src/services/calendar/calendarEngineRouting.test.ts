import test from "node:test";
import assert from "node:assert/strict";

import { CalendarEngine } from "./calendarEngineFacade.js";
import {
  buildNatalieEngineContext,
  isCalendarEngineFailure,
  mapEngineFailureToSchedulingError,
} from "./calendarEngineRouting.js";

test("buildNatalieEngineContext uses natalie_ai source and natalie actor", () => {
  const ctx = buildNatalieEngineContext({ organizationId: "org-1", userId: "user-1" });
  assert.equal(ctx.source, "natalie_ai");
  assert.equal(ctx.actor.actorType, "natalie");
  assert.equal(ctx.actor.actorUserId, "user-1");
  assert.equal(ctx.sourceModule, "scheduling-facade");
});

test("isCalendarEngineFailure discriminates engine failures", () => {
  assert.equal(
    isCalendarEngineFailure({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "bad",
      classification: "validation",
      correlationId: "c1",
      durationMs: 1,
    }),
    true
  );
  assert.equal(
    isCalendarEngineFailure({
      ok: true,
      data: {},
      correlationId: "c1",
      durationMs: 1,
    }),
    false
  );
});

test("mapEngineFailureToSchedulingError maps conflict and not found", () => {
  const conflict = mapEngineFailureToSchedulingError({
    ok: false,
    code: "TIME_CONFLICT",
    message: "overlap",
    classification: "conflict",
    correlationId: "c1",
    durationMs: 1,
  });
  assert.equal(conflict.code, "time_conflict");

  const notFound = mapEngineFailureToSchedulingError({
    ok: false,
    code: "NOT_FOUND",
    message: "missing",
    classification: "not_found",
    correlationId: "c1",
    durationMs: 1,
  });
  assert.equal(notFound.code, "appointment_not_found");
});

test("CalendarEngine exports unified mutation entry points", () => {
  assert.equal(typeof CalendarEngine.createEvent, "function");
  assert.equal(typeof CalendarEngine.updateEvent, "function");
  assert.equal(typeof CalendarEngine.moveEvent, "function");
  assert.equal(typeof CalendarEngine.cancelEvent, "function");
  assert.equal(typeof CalendarEngine.deleteEvent, "function");
  assert.equal(typeof CalendarEngine.restoreEvent, "function");
  assert.equal(typeof CalendarEngine.detectConflicts, "function");
});
