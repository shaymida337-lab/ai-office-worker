"use client";

import { CalendarClock, Check, Edit3, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/natalie-ui";
import { natalie } from "@/components/natalie-ui/tokens";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { useI18n } from "@/i18n";
import { appointmentStatusBorderColor, colorWithAlpha, formatAppointmentTime, type TimelineAppointment } from "@/lib/calendarUtils";
import { calendarUi } from "./calendarUi";

const DEFAULT_COLOR = "#3B82F6";

export type CalendarEventCardAppointment = TimelineAppointment & {
  source?: "appointment" | "calendar_engine";
  googleSyncStatus?: "pending" | "synced" | "failed" | "retrying" | "disabled";
  reminderStatus?: {
    reminderState: string;
  } | null;
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
              className={`${calendarUi.clientName} ${compactMode ? "text-[11px] sm:text-xs" : "text-base sm:text-lg"} ${isCancelled ? "line-through" : ""}`}
            >
              {appointment.client.name}
            </div>
            {appointment.service?.name && (
              <div className={`mt-0.5 truncate ${calendarUi.clientNameMuted} ${isCancelled ? "line-through" : ""}`}>
                {appointment.service.name}
              </div>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <span
                className={`font-bold text-[var(--natalie-text-primary,#0F172A)] ${compactMode ? "text-[10px]" : "text-xs sm:text-sm"} ${isCancelled ? "line-through" : ""}`}
                dir="ltr"
              >
                {time}
              </span>
              {!isTimeline && (
                <span className={`text-[10px] font-semibold ${natalie.subtitle}`}>
                  · {appointment.durationMinutes} {t("calendar.minutesShort")}
                </span>
              )}
            </div>
          </div>
          {!isTimeline && <StatusBadge tone={statusTone(appointment.status)}>{statusLabel(appointment.status)}</StatusBadge>}
        </div>

        {!isTimeline && !compactMode && (
        <div className="flex flex-wrap items-center gap-1">
          {isNatalieCreated && (
            <span className={calendarUi.natalieChip}>
              <Sparkles className="h-3 w-3" />
              {t("calendar.natalie")}
            </span>
          )}
          {googleLabel && (
            <StatusBadge tone={googleSyncTone(appointment.googleSyncStatus)}>{googleLabel}</StatusBadge>
          )}
          {appointment.reminderStatus?.reminderState && (
            <StatusBadge tone={appointment.reminderStatus.reminderState === "confirmed" ? "success" : appointment.reminderStatus.reminderState === "declined" || appointment.reminderStatus.reminderState === "reminder_failed" ? "danger" : appointment.reminderStatus.reminderState === "reminder_sent" ? "info" : "warn"}>
              {appointment.reminderStatus.reminderState === "reminder_pending"
                ? "Pending"
                : appointment.reminderStatus.reminderState === "reminder_sent"
                  ? "Reminder Sent"
                  : appointment.reminderStatus.reminderState === "confirmed"
                    ? "Confirmed"
                    : appointment.reminderStatus.reminderState === "declined"
                      ? "Declined"
                      : appointment.reminderStatus.reminderState === "no_response"
                        ? "No Response"
                        : appointment.reminderStatus.reminderState === "reminder_failed"
                          ? "Reminder Failed"
                          : appointment.reminderStatus.reminderState}
            </StatusBadge>
          )}
        </div>
        )}
      </button>

      {showQuickActions && (
        <div className="flex items-center gap-1 border-t border-white/60 bg-white/50 px-2 py-1.5">
          <button
            type="button"
            className={`inline-flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs font-black ${natalie.title} transition hover:bg-white`}
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
            className="inline-flex min-h-8 items-center justify-center rounded-lg px-2 text-[var(--natalie-text-muted,#64748B)] transition hover:bg-white hover:text-[var(--natalie-text-primary,#0F172A)]"
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
