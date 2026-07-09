"use client";

import type { ReactNode } from "react";
import { StatusBadge } from "./StatusBadge";
import type { StatusBadgeTone } from "./tokens";

export function AppointmentCard({
  clientName,
  serviceName,
  timeLabel,
  durationLabel,
  statusLabel,
  statusTone,
  badges,
  onSelect,
  onQuickConfirm,
  quickConfirmLabel,
  editLabel,
  cancelled = false,
  className = "",
  style,
}: {
  clientName: string;
  serviceName?: string | null;
  timeLabel: string;
  durationLabel?: string;
  statusLabel: string;
  statusTone: StatusBadgeTone;
  badges?: ReactNode;
  onSelect?: () => void;
  onQuickConfirm?: () => void;
  quickConfirmLabel?: string;
  editLabel?: string;
  cancelled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-s-[4px] shadow-[0_4px_14px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(15,23,42,0.10)] ${cancelled ? "opacity-55" : ""} ${className}`}
      style={style}
      data-testid="appointment-card"
    >
      <button type="button" onClick={onSelect} className="block w-full p-2.5 text-start sm:p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={`truncate text-base font-black text-[#111827] sm:text-lg ${cancelled ? "line-through" : ""}`}>
              {clientName}
            </div>
            {serviceName ? (
              <div className={`mt-0.5 truncate text-xs font-semibold text-[#4B5563] ${cancelled ? "line-through" : ""}`}>
                {serviceName}
              </div>
            ) : null}
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span className={`text-xs font-bold text-[#1F2937] sm:text-sm ${cancelled ? "line-through" : ""}`} dir="ltr">
                {timeLabel}
              </span>
              {durationLabel ? <span className="text-[10px] font-semibold text-[#6B7280]">· {durationLabel}</span> : null}
            </div>
          </div>
          <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
        </div>
        {badges ? <div className="flex flex-wrap items-center gap-1">{badges}</div> : null}
      </button>
      {(onSelect || onQuickConfirm) && !cancelled ? (
        <div className="flex items-center gap-1 border-t border-white/60 bg-white/50 px-2 py-1.5">
          {onSelect && editLabel ? (
            <button
              type="button"
              className="inline-flex min-h-8 flex-1 items-center justify-center rounded-lg px-2 text-xs font-black text-[#111827] transition hover:bg-white"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
            >
              {editLabel}
            </button>
          ) : null}
          {onQuickConfirm && quickConfirmLabel ? (
            <button
              type="button"
              className="inline-flex min-h-8 flex-1 items-center justify-center rounded-lg bg-[#1D4ED8] px-2 text-xs font-black text-white transition hover:bg-[#1E40AF]"
              onClick={(e) => {
                e.stopPropagation();
                onQuickConfirm();
              }}
            >
              {quickConfirmLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
