import assert from "node:assert/strict";
import test from "node:test";
import { buildYourDayItems } from "./yourDay.js";

test("buildYourDayItems prioritizes upcoming appointment with calendar route", () => {
  const now = new Date("2026-07-02T09:00:00");
  const items = buildYourDayItems({
    now,
    upcomingAppointments: [{ id: "a1", startTime: "2026-07-02T10:00:00", clientName: "דנה" }],
    pendingPayments: 2,
  });
  assert.match(items[0]?.text ?? "", /שעה/);
  assert.equal(items[0]?.actionKey, "appointment");
  assert.equal(items[0]?.href, "/dashboard/calendar");
});

test("buildYourDayItems maps overdue payments to payments route", () => {
  const items = buildYourDayItems({ overduePayments: 2 });
  const payment = items.find((item) => item.actionKey === "payment_overdue");
  assert.ok(payment);
  assert.equal(payment?.href, "/payments");
});

test("buildYourDayItems maps documents and tasks to correct routes", () => {
  const items = buildYourDayItems({ pendingDocuments: 3, openTasks: 5 });
  assert.equal(items.find((item) => item.actionKey === "document_review")?.href, "/dashboard/document-reviews");
  assert.equal(items.find((item) => item.actionKey === "open_task")?.href, "/tasks");
});

test("buildYourDayItems calm state is informational only", () => {
  const items = buildYourDayItems({
    pendingPayments: 0,
    pendingDocuments: 0,
    openTasks: 0,
  });
  assert.equal(items[0]?.actionKey, "all_clear");
  assert.equal(items[0]?.href, null);
  assert.match(items[0]?.text ?? "", /אין משימות דחופות/);
});
