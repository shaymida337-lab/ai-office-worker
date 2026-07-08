import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSchedulingDedupKey,
  dedupeSchedulingItems,
  type DedupableSchedulingItem,
} from "./schedulingDedup.js";

const ORG = "org-dedup";

function item(partial: Partial<DedupableSchedulingItem> & Pick<DedupableSchedulingItem, "id" | "source" | "clientName" | "startTime" | "durationMinutes">): DedupableSchedulingItem {
  return {
    organizationId: ORG,
    ...partial,
  };
}

test("googleEventId collapses Appointment + CalendarEvent duplicates", () => {
  const appt = item({
    id: "appt-1",
    source: "appointment",
    clientName: "שרית",
    startTime: new Date("2026-08-01T09:00:00.000Z"),
    durationMinutes: 60,
    googleEventId: "g-1",
  });
  const evt = item({
    id: "evt-1",
    source: "calendar_event",
    clientName: "שרית לוי",
    startTime: new Date("2026-08-01T09:00:00.000Z"),
    durationMinutes: 60,
    googleEventId: "g-1",
  });
  assert.equal(buildSchedulingDedupKey(appt, ORG), buildSchedulingDedupKey(evt, ORG));
  const deduped = dedupeSchedulingItems([appt, evt], ORG);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]!.id, "evt-1");
  assert.equal(deduped[0]!.source, "calendar_event");
});

test("slot identity collapses duplicates without googleEventId", () => {
  const appt = item({
    id: "appt-1",
    source: "appointment",
    clientName: "  דני כהן ",
    startTime: new Date("2026-08-01T10:00:00.000Z"),
    durationMinutes: 30,
    phone: "050-1234567",
  });
  const evt = item({
    id: "evt-1",
    source: "calendar_event",
    clientName: "דני כהן",
    startTime: new Date("2026-08-01T10:00:00.000Z"),
    durationMinutes: 30,
    phone: "0501234567",
  });
  const deduped = dedupeSchedulingItems([appt, evt], ORG);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]!.source, "calendar_event");
});

test("distinct bookings are preserved", () => {
  const a = item({
    id: "a",
    source: "appointment",
    clientName: "א",
    startTime: new Date("2026-08-01T10:00:00.000Z"),
    durationMinutes: 30,
  });
  const b = item({
    id: "b",
    source: "calendar_event",
    clientName: "ב",
    startTime: new Date("2026-08-01T11:00:00.000Z"),
    durationMinutes: 30,
  });
  assert.equal(dedupeSchedulingItems([a, b], ORG).length, 2);
});
