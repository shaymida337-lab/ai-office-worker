import type { HomeMetricId } from "@/lib/business-module";

export const DASHBOARD_NO_DATA_LABEL = "אין נתונים";

export type DashboardHomeMetricId =
  | "active_clients"
  | "open_tasks"
  | "meetings_today"
  | "pending_docs"
  | "new_clients_this_month"
  | "unread_alerts";

export type DashboardHomeMetricsResponse = {
  organizationId: string;
  computedAt: string;
  timeZone: string;
  metrics: Record<DashboardHomeMetricId, number>;
  definitions: Record<DashboardHomeMetricId, string>;
};

export type DashboardHomeMetricSnapshot = Record<
  Exclude<HomeMetricId, "renewals_placeholder">,
  number | null
>;

export function formatDashboardMetricValue(
  value: number | null | undefined,
  loading: boolean
): string {
  if (loading) return "—";
  if (value == null || !Number.isFinite(value)) return DASHBOARD_NO_DATA_LABEL;
  return String(value);
}

export function snapshotFromHomeMetrics(
  payload: DashboardHomeMetricsResponse | null
): DashboardHomeMetricSnapshot | null {
  if (!payload?.metrics) return null;
  return {
    active_clients: payload.metrics.active_clients,
    open_tasks: payload.metrics.open_tasks,
    meetings_today: payload.metrics.meetings_today,
    pending_docs: payload.metrics.pending_docs,
    new_clients_month: payload.metrics.new_clients_this_month,
  };
}

export function metricCount(
  snapshot: DashboardHomeMetricSnapshot | null,
  key: keyof DashboardHomeMetricSnapshot
): number | null {
  if (!snapshot) return null;
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
