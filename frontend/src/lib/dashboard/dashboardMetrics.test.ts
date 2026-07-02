import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshotMetrics, resolveOpenTasksCount } from "./dashboardMetrics.js";
import { emptyStats } from "./homePageConstants.js";

test("snapshot metrics use stats pendingInvoices without documentReviews fallback", () => {
  const metrics = buildSnapshotMetrics({
    stats: { ...emptyStats, pendingInvoices: 7, openTasks: 2 },
    pageLoading: false,
  });
  assert.equal(metrics.find((m) => m.id === "invoices")?.value, "7");
  assert.equal(metrics.find((m) => m.id === "tasks")?.value, "2");
});

test("snapshot metrics show em dash when stats unavailable", () => {
  const metrics = buildSnapshotMetrics({ stats: null, pageLoading: false });
  assert.equal(metrics.find((m) => m.id === "invoices")?.value, "—");
  assert.equal(metrics.find((m) => m.id === "tasks")?.value, "—");
});

test("resolveOpenTasksCount does not fall back to recent task list length", () => {
  assert.equal(resolveOpenTasksCount(null), 0);
  assert.equal(resolveOpenTasksCount({ ...emptyStats, openTasks: 4 }), 4);
});
