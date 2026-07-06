"use client";

import { useCallback, useMemo } from "react";
import {
  buildMonthGrid,
  DAY_NAMES_SHORT,
  isSameMonth,
  sliceMonthDayAppointments,
  toAppointmentMonthSummary,
  toDateInputValue,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import { MonthDayCell } from "./MonthDayCell";
import { useMaxVisibleAppointments } from "./useMaxVisibleAppointments";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";

type MonthCalendarViewProps<T extends TimelineAppointment> = {
  monthAnchor: Date;
  selectedDay: Date;
  today?: Date;
  appointments: T[];
  loading: boolean;
  onDayClick: (day: Date) => void;
  onDayDoubleClick?: (day: Date) => void;
  onSelectAppointment: (appointment: T) => void;
};

export function MonthCalendarView<T extends TimelineAppointment>({
  monthAnchor,
  selectedDay,
  today = new Date(),
  appointments,
  loading,
  onDayClick,
  onDayDoubleClick,
  onSelectAppointment,
}: MonthCalendarViewProps<T>) {
  const maxVisible = useMaxVisibleAppointments();
  const gridDays = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, ReturnType<typeof toAppointmentMonthSummary>[]>();
    for (const appointment of appointments) {
      const key = toDateInputValue(new Date(appointment.startTime));
      const summary = toAppointmentMonthSummary(appointment);
      const existing = map.get(key);
      if (existing) existing.push(summary);
      else map.set(key, [summary]);
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }
    return map;
  }, [appointments]);

  const hasMonthAppointments = useMemo(
    () => appointments.some((appointment) => isSameMonth(new Date(appointment.startTime), monthAnchor)),
    [appointments, monthAnchor]
  );

  const appointmentById = useMemo(() => {
    const map = new Map<string, T>();
    for (const appointment of appointments) {
      map.set(appointment.id, appointment);
    }
    return map;
  }, [appointments]);

  const handleSelectAppointment = useCallback(
    (id: string) => {
      const appointment = appointmentById.get(id);
      if (appointment) onSelectAppointment(appointment);
    },
    [appointmentById, onSelectAppointment]
  );

  return (
    <div>
      {!loading && !hasMonthAppointments && (
        <div
          className="mb-4 rounded-2xl border border-dashed border-[#BFDBFE] bg-[#EFF6FF] px-4 py-5 text-right"
          data-testid="calendar-month-empty"
        >
          <p className="text-lg font-black text-[#111827]">החודש עדיין ריק ביומן 😊</p>
          <p className="mt-2 text-base font-semibold text-[#6B7280]">רוצה שאעזור לך לקבוע את הפגישה הראשונה?</p>
          <button
            type="button"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#1D4ED8] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[#1E40AF]"
            onClick={() => openNatalieAssistant("עזרי לי לקבוע פגישה חדשה")}
          >
            בקש מנטלי
          </button>
        </div>
      )}

      {loading ? (
        <div className="skeleton min-h-[480px] rounded-2xl sm:min-h-[540px] lg:min-h-[600px]" />
      ) : (
        <div
          key={monthAnchor.toISOString()}
          className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.06)] transition-opacity duration-200"
        >
          <div className="grid grid-cols-7 border-b border-[#E5E7EB] bg-[#FAFAFA]" dir="rtl">
            {DAY_NAMES_SHORT.map((name) => (
              <div
                key={name}
                className="px-1 py-2.5 text-center text-xs font-extrabold tracking-wide text-[#6B7280]"
              >
                {name}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-[#E5E7EB] border-t-0" dir="rtl">
            {gridDays.map((day) => {
              const key = toDateInputValue(day);
              const dayAppointments = appointmentsByDay.get(key) ?? [];
              const { visible, overflowCount } = sliceMonthDayAppointments(dayAppointments, maxVisible);
              return (
                <MonthDayCell
                  key={key}
                  day={day}
                  monthAnchor={monthAnchor}
                  selectedDay={selectedDay}
                  today={today}
                  appointments={visible}
                  overflowCount={overflowCount}
                  maxVisible={maxVisible}
                  onDayClick={onDayClick}
                  onDayDoubleClick={onDayDoubleClick}
                  onSelectAppointment={handleSelectAppointment}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
