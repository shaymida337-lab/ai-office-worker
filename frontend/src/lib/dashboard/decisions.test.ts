import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionItems } from "./decisions.js";

test("buildDecisionItems renders Hebrew scheduling decision labels", () => {
  const items = buildDecisionItems([], [], [], [], [], [
    {
      id: "dec-1",
      type: "confirm_appointment",
      typeLabel: "אישור תור",
      title: "אישור תור לדנה",
      reason: "בקשה מנטלי",
      createdAt: "2026-06-21T10:00:00.000Z",
      href: "/dashboard/calendar?decisionId=dec-1",
    },
  ]);

  const scheduling = items.find((item) => item.kind === "scheduling_decision");
  assert.ok(scheduling);
  assert.equal(scheduling?.typeLabel, "אישור תור");
  assert.equal(scheduling?.description, "בקשה מנטלי");
  assert.equal(scheduling?.href, "/dashboard/calendar?decisionId=dec-1");
});

test("buildDecisionItems keeps appointment-only cards when engine OFF", () => {
  const items = buildDecisionItems([], [], [], [], [
    {
      id: "appt-1",
      clientName: "דנה",
      startTime: "2026-06-21T10:00:00.000Z",
      status: "pending",
    },
  ]);

  assert.equal(items.filter((item) => item.kind === "scheduling_decision").length, 0);
  assert.equal(items.filter((item) => item.kind === "appointment").length, 1);
});
