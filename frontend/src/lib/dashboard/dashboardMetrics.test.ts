import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSnapshotMetrics,
  DASHBOARD_KPI_LABELS,
  resolveOpenTasksCount,
  snapshotMetricHasEnglish,
} from "./dashboardMetrics.js";
import { emptyStats } from "./homePageConstants.js";

test("KPI builder returns exactly 4 metrics", () => {
  const metrics = buildSnapshotMetrics({
    stats: { ...emptyStats, pendingInvoices: 1, openTasks: 1 },
    pageLoading: false,
  });
  assert.equal(metrics.length, 4);
});

test("KPI labels match approved copy", () => {
  const metrics = buildSnapshotMetrics({ stats: emptyStats, pageLoading: false });
  assert.deepEqual(metrics.map((metric) => metric.label), [...DASHBOARD_KPI_LABELS]);
  assert.deepEqual(metrics.map((metric) => metric.id), ["in", "out", "documents", "tasks"]);
});

test("KPI uses stats-only values", () => {
  const metrics = buildSnapshotMetrics({
    stats: {
      ...emptyStats,
      moneyToReceive: 12_500,
      moneyToPay: 4_200,
      pendingInvoices: 7,
      openTasks: 2,
    },
    pageLoading: false,
  });
  assert.match(metrics[0]?.value ?? "", /₪/);
  assert.equal(metrics[2]?.value, "7");
  assert.equal(metrics[3]?.value, "2");
});

test("missing stats returns unavailable display not fake zero", () => {
  const metrics = buildSnapshotMetrics({ stats: null, pageLoading: false });
  for (const metric of metrics) {
    assert.equal(metric.value, "—");
  }
});

test("loading stats returns unavailable display not fake zero", () => {
  const metrics = buildSnapshotMetrics({ stats: emptyStats, pageLoading: true });
  for (const metric of metrics) {
    assert.equal(metric.value, "—");
  }
});

test("confirmed zero from stats renders zero", () => {
  const metrics = buildSnapshotMetrics({
    stats: { ...emptyStats, pendingInvoices: 0, openTasks: 0, moneyToReceive: 0, moneyToPay: 0 },
    pageLoading: false,
  });
  assert.equal(metrics[2]?.value, "0");
  assert.equal(metrics[3]?.value, "0");
});

test("KPI copy has no English technical terms", () => {
  const metrics = buildSnapshotMetrics({ stats: emptyStats, pageLoading: false });
  for (const metric of metrics) {
    assert.equal(snapshotMetricHasEnglish(metric.label), false);
  }
});

test("resolveOpenTasksCount does not fall back to recent task list length", () => {
  assert.equal(resolveOpenTasksCount(null), 0);
  assert.equal(resolveOpenTasksCount({ ...emptyStats, openTasks: 4 }), 4);
});
