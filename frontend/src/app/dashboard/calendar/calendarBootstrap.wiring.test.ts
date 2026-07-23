import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("calendar page First Paint uses strategy-gated bootstrap + events", async () => {
  const source = await readFile("src/app/dashboard/calendar/page.tsx", "utf8");
  assert.match(source, /runCalendarFirstPaintPhases/);
  assert.match(source, /loadCalendarBootstrap/);
  assert.match(source, /loadCalendarEvents/);
  assert.match(source, /resolveCalendarEventsStrategy/);
  assert.match(source, /searchCalendarClientsOnDemand/);
  assert.doesNotMatch(source, /reason:\s*"strategy_switch"/);

  const loadFn = source.slice(source.indexOf("const loadAppointments"), source.indexOf("const loadBriefData"));
  assert.doesNotMatch(loadFn, /\/api\/services/);
  assert.doesNotMatch(loadFn, /\/api\/clients"/);
  assert.doesNotMatch(loadFn, /\/api\/employees/);
  assert.doesNotMatch(loadFn, /fetchSchedulingCapabilities/);
});

test("calendar page invalidates events after mutations and searches clients on demand", async () => {
  const source = await readFile("src/app/dashboard/calendar/page.tsx", "utf8");
  assert.match(source, /invalidateAllCalendarEvents\(\)/);
  assert.match(source, /invalidateCalendarBootstrap\(\)/);
  assert.match(source, /\/api\/calendar\/clients\/search|searchCalendarClientsOnDemand/);
});
