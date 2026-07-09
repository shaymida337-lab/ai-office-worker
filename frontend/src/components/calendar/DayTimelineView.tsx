"use client";

import { useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import {
  TIMELINE_END_HOUR,
  TIMELINE_START_HOUR,
  PX_PER_MINUTE,
  formatDayLabel,
  formatHourLabel,
  getTimelineHeightPx,
  getTimelineHours,
  layoutDayAppointments,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
import { CalendarEventCard, type CalendarEventCardAppointment } from "./CalendarEventCard";

const btnSecondarySm =
  "inline-flex min-h-8 items-center justify-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-black text-[#111827] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-60";

type DayTimelineViewProps<T extends CalendarEventCardAppointment> = {
  date: Date;
  appointments: T[];
  loading: boolean;
  onSelectAppointment: (appointment: T) => void;
  onQuickConfirm?: (appointment: T) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
};

export function DayTimelineView<T extends CalendarEventCardAppointment>({
  date,
  appointments,
  loading,
  onSelectAppointment,
  onQuickConfirm,
  onPrevDay,
  onNextDay,
  onToday,
  statusLabel,
  statusTone,
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
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
          className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] shadow-[0_4px_16px_rgba(15,23,42,0.06)] transition-opacity duration-200 animate-[toastSlide_.25s_ease]"
        >
          <div className="max-h-[min(76vh,620px)] overflow-y-auto overscroll-contain">
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
                  <div
                    className="absolute inset-0 flex items-center justify-center p-6 text-center"
                    data-testid="calendar-day-empty"
                  >
                    <div className="max-w-xs rounded-2xl border border-dashed border-[#BFDBFE] bg-[#EFF6FF] px-5 py-6">
                      <p className="text-base font-black text-[#111827]">היום שלך פנוי 😊</p>
                      <p className="mt-2 text-sm font-semibold text-[#6B7280]">רוצה שאעזור לך לקבוע פגישה?</p>
                      <button
                        type="button"
                      className="mt-3 inline-flex min-h-9 items-center justify-center rounded-xl bg-[#1D4ED8] px-4 text-sm font-black text-white"
                        onClick={() => openNatalieAssistant("עזרי לי לקבוע פגישה חדשה")}
                      >
                        בקש מנטלי
                      </button>
                    </div>
                  </div>
                )}

                {positionedAppointments.map((block) => {
                  const appt = block.appointment;
                  const widthPercent = 100 / block.columnCount;
                  const rightPercent = block.columnIndex * widthPercent;

                  return (
                    <CalendarEventCard
                      key={appt.id}
                      appointment={appt}
                      variant="timeline"
                      statusLabel={statusLabel}
                      statusTone={statusTone}
                      onSelect={() => onSelectAppointment(appt)}
                      onQuickConfirm={onQuickConfirm ? () => onQuickConfirm(appt) : undefined}
                      className="absolute z-10 !rounded-lg !p-0 hover:z-20"
                      style={{
                        top: block.topPx,
                        height: block.heightPx,
                        right: `calc(${rightPercent}% + 4px)`,
                        width: `calc(${widthPercent}% - 8px)`,
                      }}
                    />
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
