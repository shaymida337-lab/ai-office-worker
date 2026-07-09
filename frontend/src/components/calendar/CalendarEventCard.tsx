"use client";

import { CalendarClock, Check, Edit3, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { useI18n } from "@/i18n";
import { appointmentStatusBorderColor, colorWithAlpha, formatAppointmentTime, type TimelineAppointment } from "@/lib/calendarUtils";

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

function googleSyncLabel(status: CalendarEventCardAppointment["googleSyncStatus"] | undefined, t: (key: string) => string): string | null {
  switch (status) {
    case "synced":
      return t("calendar.googleSynced");
    case "pending":
      return t("calendar.googlePending");
    case "failed":
      return t("calendar.googleFailed");
    case "retrying":
      return t("calendar.googleRetrying");
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
  const { t, dir } = useI18n();
  const orgTimezone = useOrganizationTimezone();
  const color = appointment.service?.color || DEFAULT_COLOR;
  const isCancelled = appointment.status === "cancelled";
  const time = formatAppointmentTime(appointment.startTime, orgTimezone);
  const googleLabel = googleSyncLabel(appointment.googleSyncStatus, t);
  const isNatalieCreated = appointment.source === "calendar_engine";
  const showQuickActions = variant !== "timeline" && !isCancelled;
  const isTimeline = variant === "timeline";
  const statusAccent = appointmentStatusBorderColor(appointment.status);
  const compactMode = variant === "compact" || variant === "timeline";

  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-s-[4px] ${dir === "rtl" ? "text-right" : "text-left"} shadow-[0_4px_14px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(15,23,42,0.10)] ${isCancelled ? "opacity-55" : ""} ${isTimeline ? "!rounded-xl !shadow-sm hover:!translate-y-0 hover:!shadow-md" : ""} ${className}`}
      style={{
        backgroundColor: colorWithAlpha(color, 0.12),
        borderColor: colorWithAlpha(color, 0.28),
        borderInlineStartColor: statusAccent,
        ...style,
      }}
      data-testid="calendar-event-card"
    >
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full ${dir === "rtl" ? "text-right" : "text-left"} ${isTimeline ? "p-1.5" : "p-2.5 sm:p-3"}`}
      >
        <div className={`mb-1.5 flex items-start justify-between gap-2 ${isTimeline ? "!mb-1" : ""}`}>
          <div className="min-w-0">
            <div
              className={`truncate font-black text-[#111827] ${compactMode ? "text-[11px] sm:text-xs" : "text-base sm:text-lg"} ${isCancelled ? "line-through" : ""}`}
            >
              {appointment.client.name}
            </div>
            {appointment.service?.name && (
              <div className={`mt-0.5 truncate text-xs font-semibold text-[#4B5563] ${isCancelled ? "line-through" : ""}`}>
                {appointment.service.name}
              </div>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span
                className={`font-bold text-[#1F2937] ${compactMode ? "text-[10px]" : "text-xs sm:text-sm"} ${isCancelled ? "line-through" : ""}`}
                dir="ltr"
              >
                {time}
              </span>
              {!isTimeline && (
                <span className="text-[10px] font-semibold text-[#6B7280]">
                  · {appointment.durationMinutes} {t("calendar.minutesShort")}
                </span>
              )}
            </div>
          </div>
          {!isTimeline && <StatusPill tone={statusTone(appointment.status)}>{statusLabel(appointment.status)}</StatusPill>}
        </div>

        {!isTimeline && !compactMode && (
        <div className="flex flex-wrap items-center gap-1">
          {isNatalieCreated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-bold text-[#4338CA]">
              <Sparkles className="h-3 w-3" />
              {t("calendar.natalie")}
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
            {t("calendar.edit")}
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
              {t("calendar.approve")}
            </button>
          )}
          <button
            type="button"
            className="inline-flex min-h-8 items-center justify-center rounded-lg px-2 text-[#6B7280] transition hover:bg-white hover:text-[#111827]"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.();
            }}
            aria-label={t("calendar.meetingDetails")}
          >
            <CalendarClock className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
