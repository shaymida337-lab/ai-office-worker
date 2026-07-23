import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCalendarFirstPaintBudget,
  CALENDAR_FIRST_PAINT_FORBIDDEN_KEYS,
  CALENDAR_FIRST_PAINT_KEYS,
  runCalendarFirstPaintPhases,
} from "./calendarLoadPlan";
import type { SchedulingCapabilities } from "@/lib/scheduling/capabilities";

const capsOff: SchedulingCapabilities = {
  calendarEngineReadEnabled: false,
  calendarEngineWriteEnabled: false,
  ownerDecisionQueueEnabled: false,
  googleMirrorEnabled: false,
  source: "org_disabled",
};

const capsOn: SchedulingCapabilities = {
  ...capsOff,
  calendarEngineReadEnabled: true,
  ownerDecisionQueueEnabled: true,
  source: "enabled",
};

test("calendar First Paint is bootstrap + events only", () => {
  assert.deepEqual([...CALENDAR_FIRST_PAINT_KEYS], ["calendar-bootstrap", "calendar-events"]);
  assertCalendarFirstPaintBudget();
  for (const key of CALENDAR_FIRST_PAINT_FORBIDDEN_KEYS) {
    assert.equal((CALENDAR_FIRST_PAINT_KEYS as readonly string[]).includes(key), false);
  }
});

test("warm cache: bootstrap and events start in parallel with known strategy", async () => {
  const order: string[] = [];
  let releaseBootstrap!: () => void;
  const bootstrapGate = new Promise<void>((resolve) => {
    releaseBootstrap = resolve;
  });

  const result = await runCalendarFirstPaintPhases({
    cachedCapabilities: capsOff,
    liveCapabilities: null,
    loadBootstrap: async () => {
      order.push("bootstrap_start");
      await bootstrapGate;
      order.push("bootstrap_end");
      return capsOff;
    },
    loadEvents: async (engineRead) => {
      order.push(`events_start:${engineRead}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push("events_end");
      releaseBootstrap();
    },
  });

  assert.equal(result.bootstrapAwaitedForStrategy, false);
  assert.ok(order.indexOf("events_start:false") < order.indexOf("bootstrap_end"));
  assert.equal(order.filter((x) => x.startsWith("events_start")).length, 1);
});

test("cold: events wait for bootstrap strategy then fire once", async () => {
  const order: string[] = [];
  const result = await runCalendarFirstPaintPhases({
    cachedCapabilities: null,
    liveCapabilities: null,
    loadBootstrap: async () => {
      order.push("bootstrap");
      return capsOn;
    },
    loadEvents: async (engineRead) => {
      order.push(`events:${engineRead}`);
    },
  });
  assert.equal(result.bootstrapAwaitedForStrategy, true);
  assert.equal(order[0], "bootstrap");
  assert.equal(order.length, 2);
  assert.match(order[1]!, /^events:/);
  // Exactly one events invocation — never appointments+engine double-fetch at plan layer.
  assert.equal(order.filter((x) => x.startsWith("events:")).length, 1);
});

test("First Paint ready fires before awaiting network", async () => {
  const order: string[] = [];
  await runCalendarFirstPaintPhases({
    cachedCapabilities: capsOff,
    liveCapabilities: null,
    onFirstGridReady: () => order.push("grid"),
    loadBootstrap: async () => {
      order.push("bootstrap");
      return capsOff;
    },
    loadEvents: async () => {
      order.push("events");
    },
  });
  assert.equal(order[0], "grid");
});
