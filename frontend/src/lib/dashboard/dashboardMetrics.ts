import type { DashboardStats } from "@/lib/api";
import { formatShekel } from "./homePageHelpers";

export type SnapshotMetric = {
  id: string;
  label: string;
  value: string;
};

export function buildSnapshotMetrics(input: {
  stats: DashboardStats | null;
  pageLoading: boolean;
}): SnapshotMetric[] {
  const { stats, pageLoading } = input;

  const moneyValue = (key: "moneyToReceive" | "moneyToPay"): string => {
    if (pageLoading || !stats) return formatShekel(0);
    return formatShekel(stats[key] ?? 0);
  };

  const countValue = (key: "pendingInvoices" | "openTasks"): string => {
    if (pageLoading) return "0";
    if (!stats) return "—";
    return String(stats[key] ?? 0);
  };

  return [
    { id: "in", label: "כסף נכנס החודש", value: moneyValue("moneyToReceive") },
    { id: "out", label: "כסף יוצא החודש", value: moneyValue("moneyToPay") },
    { id: "invoices", label: "חשבוניות פתוחות", value: countValue("pendingInvoices") },
    { id: "tasks", label: "משימות פתוחות", value: countValue("openTasks") },
  ];
}

export function resolveOpenTasksCount(stats: DashboardStats | null): number {
  return stats?.openTasks ?? 0;
}
