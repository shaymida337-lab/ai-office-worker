import assert from "node:assert/strict";
import test from "node:test";
import { buildYourDayItems } from "./yourDay";

test("buildYourDayItems prioritizes upcoming appointment", () => {
  const now = new Date("2026-07-02T09:00:00");
  const items = buildYourDayItems({
    now,
    upcomingAppointments: [{ id: "a1", startTime: "2026-07-02T10:00:00", clientName: "דנה" }],
    pendingPayments: 2,
  });
  assert.match(items[0]?.text ?? "", /שעה/);
});

test("buildYourDayItems shows calm message when nothing urgent", () => {
  const items = buildYourDayItems({
    pendingPayments: 0,
    pendingDocuments: 0,
    openTasks: 0,
  });
  assert.match(items[0]?.text ?? "", /אין משימות דחופות/);
});
