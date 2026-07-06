"use client";

import { useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  TIMELINE_END_HOUR,
  TIMELINE_START_HOUR,
  PX_PER_MINUTE,
  colorWithAlpha,
  formatDayLabel,
  formatHourLabel,
  getTimelineHeightPx,
  getTimelineHours,
  layoutDayAppointments,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";

const DEFAULT_COLOR = "#3B82F6";

const btnSecondarySm =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-black text-[#111827] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-60";

function appointmentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "ממתין",
    confirmed: "מאושר",
    completed: "הושלם",
    cancelled: "בוטל",
    no_show: "לא הגיע",
  };
  return labels[status] ?? status;
}

function appointmentStatusTone(status: string): "success" | "warn" | "danger" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "confirmed":
      return "info";
    case "pending":
      return "warn";
    case "cancelled":
      return "danger";
    case "no_show":
      return "neutral";
    default:
      return "neutral";
  }
}

type DayTimelineViewProps<T extends TimelineAppointment> = {
  date: Date;
  appointments: T[];
  loading: boolean;
  onSelectAppointment: (appointment: T) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  statusLabel?: (status: string) => string;
  statusTone?: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
};

export function DayTimelineView<T extends TimelineAppointment>({
  date,
  appointments,
  loading,
  onSelectAppointment,
  onPrevDay,
  onNextDay,
  onToday,
  statusLabel = appointmentStatusLabel,
  statusTone = appointmentStatusTone,
}: DayTimelineViewProps<T>) {
  const orgTimezone = useOrganizationTimezone();
  const timelineHeightPx = getTimelineHeightPx();
  const hours = getTimelineHours();
  const hourBlockPx = 60 * PX_PER_MINUTE;

  const positionedAppointments = useMemo(
    () => layoutDayAppointments(appointments, date),
    [appointments, date]
  );

  const hasAppointments = positionedAppointments.length > 0;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[#1D4ED8]" />
          <h2 className="text-lg font-black text-[#111827]">{formatDayLabel(date, orgTimezone)}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondarySm} onClick={onPrevDay} aria-label="יום קודם">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" className={btnSecondarySm} onClick={onToday}>
            היום
          </button>
          <button type="button" className={btnSecondarySm} onClick={onNextDay} aria-label="יום הבא">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton rounded-2xl" style={{ height: Math.min(timelineHeightPx, 560) }} />
      ) : (
        <div
          key={date.toISOString()}
          className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] transition-opacity duration-200 animate-[toastSlide_.25s_ease]"
        >
          <div className="max-h-[min(70vh,560px)] overflow-y-auto overscroll-contain">
            <div className="flex min-w-0" dir="rtl">
              <div
                className="relative min-w-0 flex-1 border-l border-[#E5E7EB]"
                style={{ height: timelineHeightPx }}
              >
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className="pointer-events-none absolute inset-x-0 border-t border-[#E5E7EB]/80"
                    style={{ top: index * hourBlockPx }}
                  />
                ))}
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-[#E5E7EB]"
                  style={{ top: timelineHeightPx }}
                />

                {!hasAppointments && (
                  <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                    <p className="text-sm font-semibold text-[#6B7280]">אין תורים ביום זה</p>
                  </div>
                )}

                {positionedAppointments.map((block) => {
                  const appt = block.appointment;
                  const color = appt.service?.color || DEFAULT_COLOR;
                  const isCancelled = appt.status === "cancelled";
                  const time = new Date(appt.startTime).toLocaleTimeString("he-IL", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: orgTimezone,
                  });
                  const widthPercent = 100 / block.columnCount;
                  const rightPercent = block.columnIndex * widthPercent;

                  return (
                    <button
                      key={appt.id}
                      type="button"
                      onClick={() => onSelectAppointment(appt)}
                      className={`absolute z-10 overflow-hidden rounded-xl border p-2 text-right text-xs shadow-sm transition hover:z-20 hover:shadow-md ${
                        isCancelled ? "opacity-50" : ""
                      }`}
                      style={{
                        top: block.topPx,
                        height: block.heightPx,
                        right: `calc(${rightPercent}% + 4px)`,
                        width: `calc(${widthPercent}% - 8px)`,
                        backgroundColor: colorWithAlpha(color, 0.15),
                        borderColor: colorWithAlpha(color, 0.35),
                      }}
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span className={`shrink-0 font-black ${isCancelled ? "line-through" : ""}`} dir="ltr">
                          {time}
                        </span>
                        <StatusPill tone={statusTone(appt.status)}>
                          {statusLabel(appt.status)}
                        </StatusPill>
                      </div>
                      <div className={`truncate font-black text-[#111827] ${isCancelled ? "line-through" : ""}`}>
                        {appt.client.name}
                      </div>
                      {appt.service?.name && (
                        <div
                          className={`truncate font-semibold text-[#6B7280] ${isCancelled ? "line-through" : ""}`}
                        >
                          {appt.service.name}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="w-12 shrink-0 bg-white sm:w-14" style={{ height: timelineHeightPx }}>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="relative flex items-start justify-center pt-1 text-[10px] font-bold text-[#6B7280] sm:text-xs"
                    style={{ height: hourBlockPx }}
                  >
                    <span dir="ltr">{formatHourLabel(hour)}</span>
                  </div>
                ))}
                <div className="flex h-0 items-start justify-center pt-1 text-[10px] font-bold text-[#6B7280] sm:text-xs">
                  <span dir="ltr">{formatHourLabel(TIMELINE_END_HOUR)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs font-semibold text-[#6B7280]">
        שעות {formatHourLabel(TIMELINE_START_HOUR)}–{formatHourLabel(TIMELINE_END_HOUR)}
      </p>
    </div>
  );
}
