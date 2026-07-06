import test from "node:test";
import assert from "node:assert/strict";

import {
  CalendarEngineValidationError,
  FORBIDDEN_CLIENT_EVENT_SOURCES,
  parseClientEventSource,
  parseIsoDateTime,
  parseWallClockAwareDateTime,
  pickAllowedPatchFields,
  rejectOrganizationIdInBody,
  resolveEventTimeRange,
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

test("parseWallClockAwareDateTime interprets naive strings in the org timezone", () => {
  // קיץ בישראל (IDT, UTC+3)
  const summer = parseWallClockAwareDateTime("2026-07-10T14:00:00", "startAt", "Asia/Jerusalem");
  assert.equal(summer.toISOString(), "2026-07-10T11:00:00.000Z");
  // ארגון ב-timezone אחר
  const london = parseWallClockAwareDateTime("2026-07-10T14:00", "startAt", "Europe/London");
  assert.equal(london.toISOString(), "2026-07-10T13:00:00.000Z");
});

test("parseWallClockAwareDateTime handles DST offsets per date", () => {
  // חורף בישראל (IST, UTC+2) — אותה שעת קיר, offset שונה מהקיץ
  const winter = parseWallClockAwareDateTime("2026-01-15T14:00", "startAt", "Asia/Jerusalem");
  assert.equal(winter.toISOString(), "2026-01-15T12:00:00.000Z");
});

test("parseWallClockAwareDateTime keeps Z/offset strings byte-identical to parseIsoDateTime", () => {
  for (const value of [
    "2026-07-10T14:00:00.000Z",
    "2026-07-10T14:00:00Z",
    "2026-07-10T14:00:00+05:00",
    "2026-07-10T14:00:00-02:30",
  ]) {
    const legacy = parseIsoDateTime(value, "startAt");
    const current = parseWallClockAwareDateTime(value, "startAt", "Asia/Jerusalem");
    assert.equal(current.getTime(), legacy.getTime());
  }
});

test("parseWallClockAwareDateTime falls back to Asia/Jerusalem when org timezone is empty", () => {
  for (const zone of [null, undefined, "", "   "]) {
    const parsed = parseWallClockAwareDateTime("2026-07-10T14:00:00", "startAt", zone);
    assert.equal(parsed.toISOString(), "2026-07-10T11:00:00.000Z");
  }
});

test("parseWallClockAwareDateTime rejects garbage with VALIDATION_FAILED", () => {
  for (const value of ["not-a-date", "2026-13-45T99:99", "", "   ", 42, null, undefined, {}]) {
    assert.throws(
      () => parseWallClockAwareDateTime(value, "startAt", "Asia/Jerusalem"),
      (err: unknown) => err instanceof CalendarEngineValidationError && err.code === "VALIDATION_FAILED"
    );
  }
});

test("resolveEventTimeRange derives endAt from naive duration across midnight", () => {
  const { startAt, endAt } = resolveEventTimeRange(
    "2026-07-10T23:30",
    "2026-07-11T00:30",
    "Asia/Jerusalem"
  );
  assert.equal(startAt.toISOString(), "2026-07-10T20:30:00.000Z");
  assert.equal(endAt.getTime() - startAt.getTime(), 60 * 60_000);
});

test("resolveEventTimeRange keeps real duration across the DST fall-back night", () => {
  // 25.10.2026 בישראל: 02:00 IDT חוזר ל-01:00 IST. הפרש שעון-הקיר 20:00→02:00
  // הוא 6 שעות, והמשך נשמר 6 שעות אמיתיות מ-startAt — לעומת פענוח עצמאי של
  // endAt שהיה מניב 7 שעות (02:00 כבר ב-IST) ומעוות את משך הפגישה.
  const { startAt, endAt } = resolveEventTimeRange(
    "2026-10-24T20:00",
    "2026-10-25T02:00",
    "Asia/Jerusalem"
  );
  assert.equal(startAt.toISOString(), "2026-10-24T17:00:00.000Z"); // IDT +03
  assert.equal(endAt.getTime() - startAt.getTime(), 6 * 60 * 60_000);
});

test("resolveEventTimeRange keeps explicit Z endAt as-is", () => {
  const { endAt } = resolveEventTimeRange(
    "2026-07-10T14:00",
    "2026-07-10T12:30:00.000Z",
    "Asia/Jerusalem"
  );
  assert.equal(endAt.toISOString(), "2026-07-10T12:30:00.000Z");
});

test("resolveEventTimeRange rejects reversed naive range", () => {
  assert.throws(
    () => resolveEventTimeRange("2026-07-10T14:00", "2026-07-10T13:00", "Asia/Jerusalem"),
    (err: unknown) => err instanceof CalendarEngineValidationError && err.code === "VALIDATION_FAILED"
  );
});

test("pickAllowedPatchFields parses naive startAt in org timezone and derives endAt", () => {
  const patch = pickAllowedPatchFields(
    { startAt: "2026-07-10T14:00", endAt: "2026-07-10T15:00" },
    "Asia/Jerusalem"
  );
  assert.equal(patch.startAt?.toISOString(), "2026-07-10T11:00:00.000Z");
  assert.equal((patch.endAt?.getTime() ?? 0) - (patch.startAt?.getTime() ?? 0), 60 * 60_000);
});

test("pickAllowedPatchFields keeps Z strings unchanged without timezone", () => {
  const patch = pickAllowedPatchFields({ startAt: "2026-06-25T10:00:00.000Z" });
  assert.equal(patch.startAt?.toISOString(), "2026-06-25T10:00:00.000Z");
});
