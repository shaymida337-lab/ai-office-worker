import test from "node:test";
import assert from "node:assert/strict";

import {
  CalendarEngineValidationError,
  FORBIDDEN_CLIENT_EVENT_SOURCES,
  parseClientEventSource,
  pickAllowedPatchFields,
  rejectOrganizationIdInBody,
  validateEventTimeRange,
} from "./calendarEngineValidation.js";

test("parseClientEventSource rejects ai_chat system and migration", () => {
  for (const source of FORBIDDEN_CLIENT_EVENT_SOURCES) {
    assert.throws(
      () => parseClientEventSource(source),
      (err: unknown) => err instanceof CalendarEngineValidationError && err.code === "FORBIDDEN"
    );
  }
});

test("parseClientEventSource defaults to manual", () => {
  assert.equal(parseClientEventSource(undefined), "manual");
  assert.equal(parseClientEventSource("manual"), "manual");
});

test("pickAllowedPatchFields rejects direct status changes", () => {
  assert.throws(
    () => pickAllowedPatchFields({ status: "confirmed" }),
    (err: unknown) => err instanceof CalendarEngineValidationError && err.code === "FORBIDDEN"
  );
});

test("rejectOrganizationIdInBody rejects body organizationId", () => {
  assert.throws(
    () => rejectOrganizationIdInBody({ organizationId: "evil-org" }),
    (err: unknown) => err instanceof CalendarEngineValidationError && err.code === "FORBIDDEN"
  );
});

test("validateEventTimeRange rejects zero-duration events", () => {
  const start = new Date("2026-06-25T10:00:00.000Z");
  assert.throws(
    () => validateEventTimeRange(start, start),
    (err: unknown) => err instanceof CalendarEngineValidationError
  );
});
