import assert from "node:assert/strict";
import test from "node:test";
import {
  __ageCalendarEventsCacheForTests,
  __resetCalendarEventsStoreForTests,
  __setCalendarEventsFetchForTests,
  __setCalendarEventsIdentityForTests,
  buildCalendarEventsRangeKey,
  CALENDAR_EVENTS_FRESH_MS,
  clearCalendarEvents,
  getCachedCalendarEvents,
  invalidateAllCalendarEvents,
  loadCalendarEvents,
} from "./calendarEventsStore";
import type { CalendarDisplayItem } from "@/lib/calendarEngine/adapters";

function item(id: string): CalendarDisplayItem {
  return {
    id,
    clientId: "c1",
    startTime: "2026-07-15T10:00:00.000Z",
    durationMinutes: 30,
    status: "confirmed",
    client: { id: "c1", name: "Client" },
    source: "appointment",
  };
}

const RANGE = {
  fromIso: "2026-07-12T00:00:00.000Z",
  toIso: "2026-07-19T00:00:00.000Z",
  employeeFilter: "all",
  engineRead: false,
};

test.beforeEach(() => {
  __resetCalendarEventsStoreForTests();
  __setCalendarEventsIdentityForTests(() => "user-a:org-a");
});

test("new range creates a new cache key", () => {
  const a = buildCalendarEventsRangeKey(RANGE);
  const b = buildCalendarEventsRangeKey({ ...RANGE, toIso: "2026-07-20T00:00:00.000Z" });
  assert.notEqual(a, b);
});

test("same range dedupes in-flight", async () => {
  let calls = 0;
  __setCalendarEventsFetchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return [item("1")];
  });
  const [a, b] = await Promise.all([loadCalendarEvents(RANGE), loadCalendarEvents(RANGE)]);
  assert.equal(calls, 1);
  assert.equal(a.items[0]!.id, "1");
  assert.equal(b.items[0]!.id, "1");
});

test("fresh memory → 0 network; revisit immediate", async () => {
  let calls = 0;
  __setCalendarEventsFetchForTests(async () => {
    calls += 1;
    return [item("1")];
  });
  await loadCalendarEvents(RANGE);
  const again = await loadCalendarEvents(RANGE);
  assert.equal(calls, 1);
  assert.equal(again.cacheSource, "memory");
  assert.ok(getCachedCalendarEvents(again.rangeKey));
});

test("refresh failure keeps prior events", async () => {
  let calls = 0;
  __setCalendarEventsFetchForTests(async () => {
    calls += 1;
    if (calls === 1) return [item("keep")];
    throw new Error("down");
  });
  await loadCalendarEvents(RANGE);
  const kept = await loadCalendarEvents({ ...RANGE, force: true });
  assert.equal(kept.items[0]!.id, "keep");
});

test("stale triggers background refresh", async () => {
  let calls = 0;
  __setCalendarEventsFetchForTests(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
    return [item(String(calls))];
  });
  const first = await loadCalendarEvents(RANGE);
  __ageCalendarEventsCacheForTests(first.rangeKey, CALENDAR_EVENTS_FRESH_MS + 1);
  const second = await loadCalendarEvents(RANGE);
  assert.equal(second.cacheSource, "memory");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 2);
});

test("logout clears events cache", async () => {
  __setCalendarEventsFetchForTests(async () => [item("1")]);
  await loadCalendarEvents(RANGE);
  clearCalendarEvents();
  assert.equal(getCachedCalendarEvents(buildCalendarEventsRangeKey(RANGE)), null);
  invalidateAllCalendarEvents();
});

test("cold / warm / session-equivalent: one events fetch per range, single strategy", async () => {
  const endpoints: string[] = [];
  __setCalendarEventsFetchForTests(async ({ engineRead }) => {
    endpoints.push(engineRead ? "calendar/events" : "appointments");
    return [item("1")];
  });

  // cold
  await loadCalendarEvents(RANGE);
  assert.equal(endpoints.length, 1);

  // warm memory (0 network)
  const warm = await loadCalendarEvents(RANGE);
  assert.equal(warm.cacheSource, "memory");
  assert.equal(endpoints.length, 1);

  // force = new network but still one strategy endpoint
  await loadCalendarEvents({ ...RANGE, force: true });
  assert.equal(endpoints.length, 2);
  assert.deepEqual(new Set(endpoints), new Set(["appointments"]));
});
