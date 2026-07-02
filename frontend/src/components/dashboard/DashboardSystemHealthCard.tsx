"use client";

import type { DashboardHealthRow, DashboardSyncState } from "@/lib/dashboard/dashboardSyncState";
import { colors, radius, type as typography } from "@/lib/design-tokens";

const STATUS_ICON: Record<DashboardSyncState["status"], string> = {
  CONNECTED: "🟢",
  SYNCING: "🔵",
  WARNING: "🟡",
  ERROR: "🔴",
  CHECKING: "⚪",
};

const STATUS_COLOR: Record<DashboardSyncState["status"], string> = {
  CONNECTED: colors.successText,
  SYNCING: colors.infoText,
  WARNING: colors.warnText,
  ERROR: colors.dangerText,
  CHECKING: colors.textMuted,
};

function HealthRow({ row }: { row: DashboardHealthRow }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-semibold" style={{ color: colors.textMuted }}>
        {row.label}:
      </span>
      <span className="font-bold" style={{ color: colors.textPrimary }}>
        {row.value}
      </span>
    </div>
  );
}

export function DashboardSystemHealthCard({
  state,
  loading,
}: {
  state: DashboardSyncState;
  loading?: boolean;
}) {
  return (
    <section
      className={`${radius.card} border px-4 py-4 md:px-5 md:py-5`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-live="polite"
      aria-busy={loading || state.status === "SYNCING"}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className={`${typography.sectionTitle} m-0`} style={{ color: colors.textPrimary }}>
          מצב המערכת
        </h2>
        <span className="text-lg" aria-hidden>
          {STATUS_ICON[state.status]}
        </span>
      </div>
      <p className="mb-1 text-lg font-extrabold" style={{ color: STATUS_COLOR[state.status] }}>
        {loading ? "טוען..." : state.headline}
      </p>
      <p className="mb-4 text-sm font-semibold leading-6" style={{ color: colors.textSecondary }}>
        {loading ? "בודקת חיבור, סריקה ושרת..." : state.message}
      </p>
      <div className="grid gap-2">
        {state.healthRows.map((row) => (
          <HealthRow key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}
