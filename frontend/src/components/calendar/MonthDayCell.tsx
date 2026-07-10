"use client";

import { memo, useCallback } from "react";
import { natalie } from "@/components/natalie-ui/tokens";
import { isSameCalendarDay, isSameMonth, toDateInputValue, type MonthAppointmentSummary } from "@/lib/calendarUtils";
import { calendarUi } from "./calendarUi";
import { MonthAppointmentPill } from "./MonthAppointmentPill";

export type MonthDayCellData = {
  day: Date;
  monthAnchor: Date;
  selectedDay: Date;
  today: Date;
  appointments: MonthAppointmentSummary[];
  overflowCount: number;
  maxVisible: number;
};

type MonthDayCellProps = MonthDayCellData & {
  onDayClick: (day: Date) => void;
  onDayDoubleClick?: (day: Date) => void;
  onSelectAppointment: (id: string) => void;
};

export const MonthDayCell = memo(function MonthDayCell({
  day,
  monthAnchor,
  selectedDay,
  today,
  appointments,
  overflowCount,
  maxVisible,
  onDayClick,
  onDayDoubleClick,
  onSelectAppointment,
}: MonthDayCellProps) {
  const inCurrentMonth = isSameMonth(day, monthAnchor);
  const isToday = isSameCalendarDay(day, today);
  const isSelected = isSameCalendarDay(day, selectedDay);
  const dayNumber = day.getDate();
  const totalCount = appointments.length + overflowCount;
  const compact = maxVisible <= 1;

  const handleClick = useCallback(() => {
    onDayClick(day);
  }, [day, onDayClick]);

  const handleDoubleClick = useCallback(() => {
    onDayDoubleClick?.(day);
  }, [day, onDayDoubleClick]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleClick();
        }
      }}
      data-day={toDateInputValue(day)}
      className={`group relative flex min-h-[76px] cursor-pointer flex-col p-2 text-right transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1D4ED8] sm:min-h-[100px] sm:p-2.5 lg:min-h-[118px] ${
        isSelected ? "z-[1] ring-2 ring-inset ring-[#1D4ED8]" : ""
      } ${inCurrentMonth ? calendarUi.dayCellInMonth : calendarUi.dayCellOutMonth}`}
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-black sm:h-8 sm:w-8 sm:text-sm ${
            isToday
              ? "bg-[#1D4ED8] text-white shadow-sm"
              : inCurrentMonth
                ? `font-semibold ${natalie.title}`
                : `font-normal ${natalie.subtitle}`
          }`}
        >
          {dayNumber}
        </span>
        {totalCount > 0 && inCurrentMonth && (
          <span className="rounded-full bg-[#DBEAFE] px-1.5 py-0.5 text-[10px] font-bold text-[#1D4ED8] sm:text-[11px]">
            {totalCount}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        {appointments.map((appointment) => (
          <MonthAppointmentPill
            key={appointment.id}
            appointment={appointment}
            compact={compact}
            onSelect={onSelectAppointment}
          />
        ))}
        {overflowCount > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleClick();
            }}
            className={`mt-auto inline-flex min-h-7 w-full items-center justify-end rounded-full bg-[var(--natalie-surface-elevated,#F8FAFF)] px-2 py-1 text-[10px] font-extrabold ${natalie.subtitle} transition duration-150 hover:bg-[#E2E8F0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] sm:min-h-8 sm:text-[11px]`}
          >
            +{overflowCount} נוספים
          </button>
        )}
      </div>
    </div>
  );
});
