import assert from "node:assert/strict";
import test from "node:test";
import { resolveCalendarEventsStrategy } from "./calendarEventsStrategy";
import { effectiveCalendarEngineRead } from "@/lib/scheduling/capabilities";

test("strategy known from cached bootstrap capabilities", () => {
  const caps = {
    calendarEngineReadEnabled: true,
    calendarEngineWriteEnabled: false,
    ownerDecisionQueueEnabled: true,
    googleMirrorEnabled: false,
    source: "enabled" as const,
  };
  const result = resolveCalendarEventsStrategy({
    cachedCapabilities: caps,
    liveCapabilities: null,
  });
  assert.equal(result.known, true);
  assert.equal(result.engineRead, effectiveCalendarEngineRead(caps));
});

test("strategy unknown when no capabilities yet", () => {
  const result = resolveCalendarEventsStrategy({
    cachedCapabilities: null,
    liveCapabilities: null,
  });
  assert.equal(result.known, false);
});
