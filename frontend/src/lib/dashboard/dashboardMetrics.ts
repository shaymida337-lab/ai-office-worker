import type { DashboardStats } from "@/lib/api";
import { formatShekel } from "./homePageHelpers";

export type DashboardKpiId = "in" | "out" | "documents" | "tasks";

export type SnapshotMetric = {
  id: DashboardKpiId;
  label: string;
  value: string;
};

/** Locked Home Dashboard KPI copy — exactly 4 metrics. */
export const DASHBOARD_KPI_LABELS: readonly [string, string, string, string] = [
  "כסף נכנס",
  "כסף יוצא",
  "מסמכים",
  "משימות",
];

const UNAVAILABLE = "—";

export function buildSnapshotMetrics(input: {
  stats: DashboardStats | null;
  pageLoading: boolean;
}): SnapshotMetric[] {
  const { stats, pageLoading } = input;
  const statsReady = !pageLoading && stats != null;

  const moneyValue = (key: "moneyToReceive" | "moneyToPay"): string => {
    if (!statsReady) return UNAVAILABLE;
    return formatShekel(stats![key] ?? 0);
  };

  const countValue = (key: "pendingInvoices" | "openTasks"): string => {
    if (!statsReady) return UNAVAILABLE;
    return String(stats![key] ?? 0);
  };

  return [
    { id: "in", label: DASHBOARD_KPI_LABELS[0], value: moneyValue("moneyToReceive") },
    { id: "out", label: DASHBOARD_KPI_LABELS[1], value: moneyValue("moneyToPay") },
    { id: "documents", label: DASHBOARD_KPI_LABELS[2], value: countValue("pendingInvoices") },
    { id: "tasks", label: DASHBOARD_KPI_LABELS[3], value: countValue("openTasks") },
  ];
}

export function resolveOpenTasksCount(stats: DashboardStats | null): number {
  return stats?.openTasks ?? 0;
}

export function snapshotMetricHasEnglish(text: string): boolean {
  return /[A-Za-z]{2,}/.test(text);
}
