"use client";

import { useCallback, useMemo } from "react";
import { Button } from "@/components/natalie-ui";
import {
  buildMonthGrid,
  DAY_NAMES_SHORT,
  isSameMonth,
  sliceMonthDayAppointments,
  toAppointmentMonthSummary,
  toDateInputValue,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
import { calendarUi } from "./calendarUi";
import { MonthDayCell } from "./MonthDayCell";
import { useMaxVisibleAppointments } from "./useMaxVisibleAppointments";

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
        <div className={calendarUi.emptyWrap} data-testid="calendar-month-empty">
          <p className={calendarUi.emptyTitle}>החודש עדיין ריק ביומן 😊</p>
          <p className={calendarUi.emptySubtitle}>רוצה שאעזור לך לקבוע את הפגישה הראשונה?</p>
          <Button
            size="sm"
            className="mt-4 !min-h-11 !rounded-xl !border-[#1D4ED8] !bg-[#1D4ED8] !px-5 !text-sm !text-white hover:!bg-[#1E40AF]"
            onClick={() => openNatalieAssistant("עזרי לי לקבוע פגישה חדשה")}
          >
            בקש מנטלי
          </Button>
        </div>
      )}

      {loading ? (
        <div className="skeleton min-h-[480px] rounded-2xl sm:min-h-[540px] lg:min-h-[600px]" />
      ) : (
        <div key={monthAnchor.toISOString()} className={`${calendarUi.gridShell} transition-opacity duration-200`}>
          <div className={calendarUi.gridHeader} dir="rtl">
            {DAY_NAMES_SHORT.map((name) => (
              <div key={name} className={calendarUi.gridHeaderCell}>
                {name}
              </div>
            ))}
          </div>
          <div className={calendarUi.gridDivide} dir="rtl">
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
