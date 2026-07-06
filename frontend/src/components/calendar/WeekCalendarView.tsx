"use client";

import { useMemo } from "react";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { colorWithAlpha, isSameCalendarDay, toDateInputValue, type TimelineAppointment } from "@/lib/calendarUtils";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
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
    return <div className="skeleton min-h-[320px] rounded-2xl sm:min-h-[420px]" />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7" dir="rtl">
      {weekDays.map((day, index) => {
        const key = toDateInputValue(day);
        const dayAppts = appointmentsByDay.get(key) ?? [];
        const isToday = isSameCalendarDay(day, today);

        return (
          <div
            key={key}
            className={`min-h-[180px] rounded-2xl border p-3 transition ${
              isToday
                ? "border-[#1D4ED8]/35 bg-[#EFF6FF] shadow-[0_6px_20px_rgba(29,78,216,0.08)]"
                : "border-[#E5E7EB] bg-white shadow-[0_4px_16px_rgba(15,23,42,0.04)]"
            }`}
          >
            <div className={`mb-3 text-center ${isToday ? "text-[#1D4ED8]" : "text-[#111827]"}`}>
              <div className="text-sm font-black">{DAY_NAMES[index]}</div>
              <div className="text-xs font-semibold text-[#6B7280]">
                {day.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: orgTimezone })}
              </div>
            </div>

            <div className="space-y-2">
              {dayAppts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F8FAFC] px-2 py-4 text-center">
                  <p className="text-xs font-bold text-[#6B7280]">אין פגישות</p>
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
                    className="!shadow-none hover:!shadow-md"
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
    <div
      className="mb-4 rounded-2xl border border-dashed border-[#BFDBFE] bg-[#EFF6FF] px-4 py-5 text-right"
      data-testid="calendar-week-empty"
    >
      <p className="text-lg font-black text-[#111827]">השבוע שלך פנוי 😊</p>
      <p className="mt-2 text-base font-semibold text-[#6B7280]">רוצה שאעזור לך למלא את היומן?</p>
      <button
        type="button"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D4ED8] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[#1E40AF]"
        onClick={() => (onSchedule ? onSchedule() : openNatalieAssistant("עזרי לי לקבוע פגישה חדשה"))}
      >
        בקש מנטלי
      </button>
    </div>
  );
}
