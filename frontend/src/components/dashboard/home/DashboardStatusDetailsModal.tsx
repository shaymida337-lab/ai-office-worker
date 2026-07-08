"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { DashboardSyncState } from "@/lib/dashboard/dashboardSyncState";
import { ScanBanner } from "@/components/ui/ScanBanner";
import { colors, radius, shadow, spacing, button, type as typography } from "@/lib/design-tokens";
import { MODAL_HEALTH_LABEL } from "./dashboardStatusPillCopy";

const STATUS_COLOR: Record<DashboardSyncState["status"], string> = {
  CONNECTED: colors.successText,
  SYNCING: colors.infoText,
  WARNING: colors.warnText,
  ERROR: colors.dangerText,
  CHECKING: colors.textMuted,
};

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-semibold" style={{ color: colors.textMuted }}>
        {label}:
      </span>
      <span className="min-w-0 truncate text-end font-bold" style={{ color: colors.textPrimary }} title={value}>
        {value}
      </span>
    </div>
  );
}

function ModalButton({
  children,
  onClick,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${radius.control} ${primary ? button.primary : button.secondary} min-h-11 px-4 py-2 transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
      style={
        primary
          ? { backgroundColor: colors.accent, border: `1px solid ${colors.accent}`, color: colors.surface, outlineColor: colors.surface }
          : { backgroundColor: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent, outlineColor: colors.accent }
      }
    >
      {children}
    </button>
  );
}

export function DashboardStatusDetailsModal({
  open,
  state,
  loading,
  onClose,
  onConnectGmail,
  onRetrySync,
  onOpenSettings,
}: {
  open: boolean;
  state: DashboardSyncState;
  loading?: boolean;
  onClose: () => void;
  onConnectGmail: () => void;
  onRetrySync: () => void;
  onOpenSettings: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const showScanProgress =
    state.status === "SYNCING" && state.scanBanner?.status === "running" && state.scanBanner;

  const recoveryAction =
    state.status === "ERROR"
      ? state.heroTrust.ctaAction === "connect_gmail"
        ? { label: "חבר ג׳ימייל", onClick: onConnectGmail }
        : { label: "נסה שוב", onClick: onRetrySync }
      : null;

  return (
    <div
      className="fixed inset-0 z-[110] grid place-items-end bg-black/50 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
      role="presentation"
      onClick={onClose}
      data-testid="dashboard-status-modal-overlay"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-status-modal-title"
        data-testid="dashboard-status-modal"
        className={`${radius.card} ${shadow.raised} max-h-[92vh] w-full max-w-lg overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)] outline-none sm:max-h-[85vh]`}
        style={{ backgroundColor: colors.surface, border: `1px solid ${colors.border}` }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={`flex items-start justify-between gap-3 border-b px-4 py-4 md:px-5 ${spacing.inline}`} style={{ borderColor: colors.borderSubtle }}>
          <div className="min-w-0">
            <h2 id="dashboard-status-modal-title" className={`${typography.sectionTitle} m-0`} style={{ color: colors.textPrimary }}>
              מצב המערכת
            </h2>
            <p className={`${typography.body} mt-1 font-extrabold`} style={{ color: STATUS_COLOR[state.status] }}>
              {loading ? "טוען..." : state.headline}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className={`${radius.control} flex h-11 w-11 shrink-0 items-center justify-center text-2xl font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
            style={{ color: colors.textMuted, backgroundColor: colors.bgSoft, outlineColor: colors.accent }}
          >
            ×
          </button>
        </header>

        <div className={`grid gap-4 px-4 py-4 md:px-5 ${spacing.inline}`}>
          <p className={`${typography.body} m-0 font-semibold leading-7`} style={{ color: colors.textSecondary }}>
            {loading ? "בודקת חיבור, סריקה ושרת..." : state.message}
          </p>

          {showScanProgress ? (
            <ScanBanner
              status={state.scanBanner!.status}
              found={state.scanBanner!.found}
              scanned={state.scanBanner!.scanned}
              totalMatched={state.scanBanner!.totalMatched}
              errors={state.scanBanner!.errors}
            />
          ) : null}

          <div className="grid gap-2">
            {state.healthRows.map((row) => (
              <HealthRow
                key={row.key}
                label={MODAL_HEALTH_LABEL[row.key] ?? row.label}
                value={row.key === "backend" && row.value === "תקין" ? "תקין" : row.value}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            {recoveryAction ? (
              <ModalButton primary onClick={() => { recoveryAction.onClick(); onClose(); }}>
                {recoveryAction.label}
              </ModalButton>
            ) : null}
            <ModalButton onClick={onOpenSettings}>הגדרות</ModalButton>
          </div>
        </div>
      </div>
    </div>
  );
}
