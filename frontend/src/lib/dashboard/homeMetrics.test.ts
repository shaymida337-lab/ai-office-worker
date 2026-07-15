import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_NO_DATA_LABEL,
  formatDashboardMetricValue,
  snapshotFromHomeMetrics,
} from "./homeMetrics.ts";

test("snapshotFromHomeMetrics maps API payload to dashboard keys", () => {
  const snapshot = snapshotFromHomeMetrics({
    organizationId: "org-1",
    computedAt: "2026-07-15T10:00:00.000Z",
    timeZone: "Asia/Jerusalem",
    metrics: {
      active_clients: 7,
      open_tasks: 5,
      meetings_today: 3,
      pending_docs: 4,
      new_clients_this_month: 2,
      unread_alerts: 1,
    },
    definitions: {
      active_clients: "",
      open_tasks: "",
      meetings_today: "",
      pending_docs: "",
      new_clients_this_month: "",
      unread_alerts: "",
    },
  });
  assert.deepEqual(snapshot, {
    active_clients: 7,
    open_tasks: 5,
    meetings_today: 3,
    pending_docs: 4,
    new_clients_month: 2,
  });
});

test("formatDashboardMetricValue never fabricates zero on missing data", () => {
  assert.equal(formatDashboardMetricValue(null, false), DASHBOARD_NO_DATA_LABEL);
  assert.equal(formatDashboardMetricValue(undefined, true), "—");
  assert.equal(formatDashboardMetricValue(0, false), "0");
});
