"use client";

import { CalendarClock, Check, Edit3, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { colorWithAlpha, formatAppointmentTime, type TimelineAppointment } from "@/lib/calendarUtils";

const DEFAULT_COLOR = "#3B82F6";

export type CalendarEventCardAppointment = TimelineAppointment & {
  source?: "appointment" | "calendar_engine";
  googleSyncStatus?: "pending" | "synced" | "failed" | "retrying" | "disabled";
};

type CalendarEventCardProps = {
  appointment: CalendarEventCardAppointment;
  variant?: "compact" | "timeline" | "week";
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
  onSelect?: () => void;
  onQuickConfirm?: () => void;
  className?: string;
  style?: React.CSSProperties;
};

function googleSyncLabel(status?: CalendarEventCardAppointment["googleSyncStatus"]): string | null {
  switch (status) {
    case "synced":
      return "Google";
    case "pending":
      return "Google…";
    case "failed":
      return "Google ✕";
    case "retrying":
      return "Google ↻";
    default:
      return null;
  }
}

function googleSyncTone(status?: CalendarEventCardAppointment["googleSyncStatus"]) {
  switch (status) {
    case "failed":
      return "danger" as const;
    case "retrying":
    case "pending":
      return "warn" as const;
    case "synced":
      return "success" as const;
    default:
      return "neutral" as const;
  }
}

export function CalendarEventCard({
  appointment,
  variant = "week",
  statusLabel,
  statusTone,
  onSelect,
  onQuickConfirm,
  className = "",
  style,
}: CalendarEventCardProps) {
  const orgTimezone = useOrganizationTimezone();
  const color = appointment.service?.color || DEFAULT_COLOR;
  const isCancelled = appointment.status === "cancelled";
  const time = formatAppointmentTime(appointment.startTime, orgTimezone);
  const googleLabel = googleSyncLabel(appointment.googleSyncStatus);
  const isNatalieCreated = appointment.source === "calendar_engine";
  const showQuickActions = variant !== "timeline" && !isCancelled;
  const isTimeline = variant === "timeline";

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border text-right shadow-[0_4px_16px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)] ${isCancelled ? "opacity-55" : ""} ${isTimeline ? "!rounded-xl !shadow-sm hover:!translate-y-0 hover:!shadow-md" : ""} ${className}`}
      style={{
        backgroundColor: colorWithAlpha(color, 0.12),
        borderColor: colorWithAlpha(color, 0.28),
        ...style,
      }}
      data-testid="calendar-event-card"
    >
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full text-right ${isTimeline ? "p-1.5" : "p-3 sm:p-3.5"}`}
      >
        <div className={`mb-2 flex items-start justify-between gap-2 ${isTimeline ? "!mb-0.5" : ""}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`font-black text-[#111827] ${isTimeline ? "text-[10px] sm:text-xs" : "text-sm sm:text-base"} ${isCancelled ? "line-through" : ""}`}
                dir="ltr"
              >
                {time}
              </span>
              {!isTimeline && (
                <span className="text-xs font-semibold text-[#6B7280]">· {appointment.durationMinutes} דק׳</span>
              )}
            </div>
            <div
              className={`mt-1 truncate font-black text-[#111827] ${isTimeline ? "text-[11px] sm:text-xs" : "text-base sm:text-lg"} ${isCancelled ? "line-through" : ""}`}
            >
              {appointment.client.name}
            </div>
            {appointment.service?.name && !isTimeline && (
              <div className={`truncate text-sm font-semibold text-[#6B7280] ${isCancelled ? "line-through" : ""}`}>
                {appointment.service.name}
              </div>
            )}
          </div>
          {!isTimeline && <StatusPill tone={statusTone(appointment.status)}>{statusLabel(appointment.status)}</StatusPill>}
        </div>

        {!isTimeline && (
        <div className="flex flex-wrap items-center gap-1.5">
          {isNatalieCreated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[11px] font-bold text-[#4338CA]">
              <Sparkles className="h-3 w-3" />
              נטלי
            </span>
          )}
          {googleLabel && (
            <StatusPill tone={googleSyncTone(appointment.googleSyncStatus)}>{googleLabel}</StatusPill>
          )}
        </div>
        )}
      </button>

      {showQuickActions && (
        <div className="flex items-center gap-1 border-t border-white/60 bg-white/50 px-2 py-1.5">
          <button
            type="button"
            className="inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs font-black text-[#111827] transition hover:bg-white"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
            }}
          >
            <Edit3 className="h-3.5 w-3.5" />
            עריכה
          </button>
          {appointment.status === "pending" && onQuickConfirm && (
            <button
              type="button"
              className="inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-[#1D4ED8] px-2 text-xs font-black text-white transition hover:bg-[#1E40AF]"
              onClick={(event) => {
                event.stopPropagation();
                onQuickConfirm();
              }}
            >
              <Check className="h-3.5 w-3.5" />
              אישור
            </button>
          )}
          <button
            type="button"
            className="inline-flex min-h-8 items-center justify-center rounded-lg px-2 text-[#6B7280] transition hover:bg-white hover:text-[#111827]"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
            }}
            aria-label="פרטי פגישה"
          >
            <CalendarClock className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
