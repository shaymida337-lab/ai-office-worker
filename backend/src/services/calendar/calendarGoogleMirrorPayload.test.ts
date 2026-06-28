import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeCalendarEngineGooglePayload,
  buildCalendarEngineGoogleEventBody,
  buildCalendarEngineGoogleEventSummary,
  CALENDAR_ENGINE_GOOGLE_DESCRIPTION,
  resolvePublicGoogleLocation,
} from "./calendarGoogleMirrorPayload.js";

test("buildCalendarEngineGoogleEventSummary uses client and service names", () => {
  assert.equal(
    buildCalendarEngineGoogleEventSummary({
      clientName: "דנה",
      serviceName: "ייעוץ",
      title: null,
      startAt: new Date(),
      endAt: new Date(),
      timezone: "Asia/Jerusalem",
    }),
    "דנה — ייעוץ"
  );
});

test("buildCalendarEngineGoogleEventSummary falls back to תור for missing service", () => {
  assert.equal(
    buildCalendarEngineGoogleEventSummary({
      clientName: "דנה",
      serviceName: null,
      title: null,
      startAt: new Date(),
      endAt: new Date(),
      timezone: "Asia/Jerusalem",
    }),
    "דנה — תור"
  );
});

test("resolvePublicGoogleLocation excludes remote and empty address", () => {
  assert.equal(resolvePublicGoogleLocation("office", "רחוב הרצל 1"), "רחוב הרצל 1");
  assert.equal(resolvePublicGoogleLocation("remote", "https://meet.example/secret"), undefined);
  assert.equal(resolvePublicGoogleLocation("office", "  "), undefined);
});

test("payload excludes internal notes payment timeline and audit fields", () => {
  const body = buildCalendarEngineGoogleEventBody({
    clientName: "דנה",
    serviceName: "ייעוץ",
    title: "פגישה",
    startAt: new Date("2026-06-25T10:00:00.000Z"),
    endAt: new Date("2026-06-25T11:00:00.000Z"),
    timezone: "Asia/Jerusalem",
    locationType: "office",
    address: "רחוב הרצל 1",
    internalNotes: "payment pending invoice #123 audit trail",
    completionNotes: "timeline secret",
    prerequisitesJson: [{ id: "payment", label: "Payment" }],
  });

  assert.equal(body.description, CALENDAR_ENGINE_GOOGLE_DESCRIPTION);
  assert.equal(body.summary, "דנה — ייעוץ");
  assert.equal(body.location, "רחוב הרצל 1");
  assert.equal(body.start.timeZone, "Asia/Jerusalem");
  assert.doesNotMatch(JSON.stringify(body), /payment|invoice|audit|timeline|internal/i);
  assertSafeCalendarEngineGooglePayload(body);
});
