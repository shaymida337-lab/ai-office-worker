"use client";

import type { DashboardSyncState } from "@/lib/dashboard/dashboardSyncState";
import { colors, radius, type as typography } from "@/lib/design-tokens";
import { buildDashboardStatusPillLabel } from "./dashboardStatusPillCopy";

const STATUS_TONE: Record<DashboardSyncState["status"], string> = {
  CONNECTED: colors.successText,
  SYNCING: colors.infoText,
  WARNING: colors.warnText,
  ERROR: colors.dangerText,
  CHECKING: colors.textMuted,
};

const STATUS_BG: Record<DashboardSyncState["status"], string> = {
  CONNECTED: colors.successBg,
  SYNCING: colors.infoBg,
  WARNING: colors.warnBg,
  ERROR: colors.dangerBg,
  CHECKING: colors.bgSoft,
};

const STATUS_BORDER: Record<DashboardSyncState["status"], string> = {
  CONNECTED: colors.successBorder,
  SYNCING: colors.infoBorder,
  WARNING: colors.warnBorder,
  ERROR: colors.dangerBorder,
  CHECKING: colors.border,
};

export function DashboardStatusPill({
  state,
  loading,
  onOpenDetails,
}: {
  state: DashboardSyncState;
  loading?: boolean;
  onOpenDetails: () => void;
}) {
  const label = buildDashboardStatusPillLabel(state, loading);
  const status = loading ? "CHECKING" : state.status;

  return (
    <div className="dashboard-fade-in flex min-w-0 max-w-full justify-start">
      <button
        type="button"
        data-testid="dashboard-status-pill"
        onClick={onOpenDetails}
        aria-label={`מצב המערכת: ${label.replace(/^[^\s]+\s/, "")}`}
        aria-haspopup="dialog"
        aria-expanded={false}
        aria-busy={loading || state.status === "SYNCING"}
        className={`inline-flex min-h-11 max-w-full min-w-0 items-center gap-1 border px-3 py-2 text-start transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${radius.pill} ${typography.caption}`}
        style={{
          color: STATUS_TONE[status],
          backgroundColor: STATUS_BG[status],
          borderColor: STATUS_BORDER[status],
          outlineColor: colors.accent,
        }}
      >
        <span className="min-w-0 truncate font-bold leading-snug" title={label}>
          {label}
        </span>
      </button>
    </div>
  );
}
