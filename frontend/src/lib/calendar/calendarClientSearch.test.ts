import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarClientSearchPath,
  mergeCalendarClientOptions,
  selectCalendarClientFromHits,
} from "./calendarClientSearch";

test("buildCalendarClientSearchPath encodes q and id", () => {
  assert.equal(buildCalendarClientSearchPath({ query: "דנה" }), "/api/calendar/clients/search?q=%D7%93%D7%A0%D7%94");
  assert.equal(buildCalendarClientSearchPath({ clientId: "c-201" }), "/api/calendar/clients/search?id=c-201");
  assert.equal(buildCalendarClientSearchPath({}), null);
});

test("201+ clients: last/beyond-summary client can be merged and selected", () => {
  const summary = Array.from({ length: 200 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `Client ${i + 1}`,
  }));
  const beyond = { id: "c-beyond-201", name: "לקוח מעבר ל-200" };
  const hits = [beyond];
  const merged = mergeCalendarClientOptions(summary, hits, 220);
  assert.equal(merged.length, 201);
  const selected = selectCalendarClientFromHits(merged, beyond.id);
  assert.ok(selected);
  assert.equal(selected!.name, "לקוח מעבר ל-200");
});
