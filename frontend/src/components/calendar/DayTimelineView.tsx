"use client";

import { useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/natalie-ui";
import { natalie } from "@/components/natalie-ui/tokens";
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
import { calendarUi } from "./calendarUi";
import { CalendarEventCard, type CalendarEventCardAppointment } from "./CalendarEventCard";

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
          <Calendar className={`h-5 w-5 ${natalie.accent}`} />
          <h2 className={`text-lg font-black ${natalie.title}`}>{formatDayLabel(date, orgTimezone)}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={onPrevDay} aria-label="יום קודם">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={onToday}>
            היום
          </Button>
          <Button variant="secondary" size="sm" type="button" onClick={onNextDay} aria-label="יום הבא">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton rounded-2xl" style={{ height: Math.min(timelineHeightPx, 560) }} />
      ) : (
        <div
          key={date.toISOString()}
          className={`${calendarUi.timelineShell} transition-opacity duration-200 animate-[toastSlide_.25s_ease]`}
        >
          <div className="max-h-[min(76vh,620px)] overflow-y-auto overscroll-contain">
            <div className="flex min-w-0" dir="rtl">
              <div className={calendarUi.timelineLane} style={{ height: timelineHeightPx }}>
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className={calendarUi.timelineHour}
                    style={{ top: index * hourBlockPx }}
                  />
                ))}
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-[var(--natalie-border,#D9E2F2)]"
                  style={{ top: timelineHeightPx }}
                />

                {!hasAppointments && (
                  <div
                    className="absolute inset-0 flex items-center justify-center p-6 text-center"
                    data-testid="calendar-day-empty"
                  >
                    <div className={calendarUi.emptyInner}>
                      <p className={`text-base font-black ${natalie.title}`}>היום שלך פנוי 😊</p>
                      <p className={`mt-2 text-sm font-semibold ${natalie.subtitle}`}>רוצה שאעזור לך לקבוע פגישה?</p>
                      <Button
                        size="sm"
                        className="mt-3 !min-h-9 !rounded-xl !border-[#1D4ED8] !bg-[#1D4ED8] !px-4 !text-sm !text-white"
                        onClick={() => openNatalieAssistant("עזרי לי לקבוע פגישה חדשה")}
                      >
                        בקש מנטלי
                      </Button>
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

              <div className={calendarUi.timelineRuler} style={{ height: timelineHeightPx }}>
                {hours.map((hour) => (
                  <div key={hour} className={calendarUi.timelineRulerLabel} style={{ height: hourBlockPx }}>
                    <span dir="ltr">{formatHourLabel(hour)}</span>
                  </div>
                ))}
                <div className={`flex h-0 items-start justify-center pt-1 text-[10px] font-bold ${natalie.subtitle} sm:text-xs`}>
                  <span dir="ltr">{formatHourLabel(TIMELINE_END_HOUR)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className={calendarUi.timelineFooter}>
        שעות {formatHourLabel(TIMELINE_START_HOUR)}–{formatHourLabel(TIMELINE_END_HOUR)}
      </p>
    </div>
  );
}
