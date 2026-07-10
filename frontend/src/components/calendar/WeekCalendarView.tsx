"use client";

import { useMemo } from "react";
import { Button } from "@/components/natalie-ui";
import { natalie } from "@/components/natalie-ui/tokens";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { colorWithAlpha, isSameCalendarDay, toDateInputValue, type TimelineAppointment } from "@/lib/calendarUtils";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
import { calendarUi, weekColumnClass } from "./calendarUi";
import { CalendarEventCard, type CalendarEventCardAppointment } from "./CalendarEventCard";

const DAY_NAMES = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

type WeekCalendarViewProps<T extends CalendarEventCardAppointment> = {
  weekDays: Date[];
  appointments: T[];
  loading: boolean;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
  onSelectAppointment: (appointment: T) => void;
  onQuickConfirm?: (appointment: T) => void;
};

export function WeekCalendarView<T extends CalendarEventCardAppointment>({
  weekDays,
  appointments,
  loading,
  statusLabel,
  statusTone,
  onSelectAppointment,
  onQuickConfirm,
}: WeekCalendarViewProps<T>) {
  const orgTimezone = useOrganizationTimezone();
  const today = new Date();

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const day of weekDays) {
      map.set(toDateInputValue(day), []);
    }
    for (const appt of appointments) {
      const key = toDateInputValue(new Date(appt.startTime));
      if (map.has(key)) {
        map.get(key)!.push(appt);
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [appointments, weekDays]);

  if (loading) {
    return <div className="skeleton min-h-[280px] rounded-2xl sm:min-h-[380px]" />;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7" dir="rtl">
      {weekDays.map((day, index) => {
        const key = toDateInputValue(day);
        const dayAppts = appointmentsByDay.get(key) ?? [];
        const isToday = isSameCalendarDay(day, today);

        return (
          <div key={key} className={weekColumnClass(isToday)}>
            <div className={`mb-2 text-center ${isToday ? "text-[#1D4ED8]" : natalie.title}`}>
              <div className="text-sm font-black">{DAY_NAMES[index]}</div>
              <div className={`text-xs font-semibold ${natalie.subtitle}`}>
                {day.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: orgTimezone })}
              </div>
            </div>

            <div className="space-y-1.5">
              {dayAppts.length === 0 ? (
                <div className={calendarUi.weekDayEmpty}>
                  <p className={`text-xs font-bold ${natalie.subtitle}`}>אין פגישות</p>
                </div>
              ) : (
                dayAppts.map((appt) => (
                  <CalendarEventCard
                    key={appt.id}
                    appointment={appt}
                    variant="week"
                    statusLabel={statusLabel}
                    statusTone={statusTone}
                    onSelect={() => onSelectAppointment(appt)}
                    onQuickConfirm={onQuickConfirm ? () => onQuickConfirm(appt) : undefined}
                    className="!shadow-none hover:!shadow-sm"
                    style={{
                      backgroundColor: colorWithAlpha(appt.service?.color || "#3B82F6", 0.1),
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WeekCalendarEmptyState({ onSchedule }: { onSchedule?: () => void }) {
  return (
    <div className={calendarUi.emptyWrap} data-testid="calendar-week-empty">
      <p className={calendarUi.emptyTitle}>השבוע שלך פנוי 😊</p>
      <p className={calendarUi.emptySubtitle}>רוצה שאעזור לך למלא את היומן?</p>
      <Button
        size="sm"
        className="mt-4 !min-h-11 !rounded-xl !border-[#1D4ED8] !bg-[#1D4ED8] !px-5 !text-sm !text-white hover:!bg-[#1E40AF]"
        onClick={() => (onSchedule ? onSchedule() : openNatalieAssistant("עזרי לי לקבוע פגישה חדשה"))}
      >
        בקש מנטלי
      </Button>
    </div>
  );
}
