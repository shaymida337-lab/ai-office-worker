import test from "node:test";
import assert from "node:assert/strict";

import {
  effectiveCalendarEngineRead,
  effectiveCalendarEngineWrite,
  effectiveOwnerDecisionQueueEnabled,
  type SchedulingCapabilities,
} from "./capabilities.js";

const enabledCapabilities: SchedulingCapabilities = {
  calendarEngineReadEnabled: true,
  calendarEngineWriteEnabled: true,
  ownerDecisionQueueEnabled: true,
  googleMirrorEnabled: true,
  source: "enabled",
};

const disabledCapabilities: SchedulingCapabilities = {
  calendarEngineReadEnabled: false,
  calendarEngineWriteEnabled: false,
  ownerDecisionQueueEnabled: false,
  googleMirrorEnabled: false,
  source: "org_disabled",
};

test("effectiveCalendarEngineRead requires UI kill switch and capabilities", () => {
  assert.equal(effectiveCalendarEngineRead(enabledCapabilities, true), true);
  assert.equal(effectiveCalendarEngineRead(enabledCapabilities, false), false);
  assert.equal(effectiveCalendarEngineRead(disabledCapabilities, true), false);
  assert.equal(effectiveCalendarEngineRead(null, true), false);
});

test("effectiveCalendarEngineWrite requires UI kill switch and capabilities", () => {
  assert.equal(effectiveCalendarEngineWrite(enabledCapabilities, true), true);
  assert.equal(effectiveCalendarEngineWrite(disabledCapabilities, true), false);
  assert.equal(effectiveCalendarEngineWrite(null, true), false);
});

test("effectiveOwnerDecisionQueueEnabled follows capabilities read gate", () => {
  assert.equal(effectiveOwnerDecisionQueueEnabled(enabledCapabilities, true), true);
  assert.equal(effectiveOwnerDecisionQueueEnabled(disabledCapabilities, true), false);
});
