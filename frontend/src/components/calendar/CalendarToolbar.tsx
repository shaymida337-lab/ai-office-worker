"use client";

import { useRef } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarViewMode } from "@/lib/calendarUtils";

const navBtnClass =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#111827] transition duration-150 hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] focus-visible:ring-offset-1";

const todayBtnClass =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white px-4 text-sm font-black text-[#111827] transition duration-150 hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] focus-visible:ring-offset-1";

type CalendarToolbarProps = {
  viewMode: CalendarViewMode;
  title: string;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  monthPickerValue?: string;
  onMonthPickerChange?: (value: string) => void;
};

const VIEW_OPTIONS: Array<{ mode: CalendarViewMode; label: string }> = [
  { mode: "day", label: "יום" },
  { mode: "week", label: "שבוע" },
  { mode: "month", label: "חודש" },
];

function ViewSwitcher({
  viewMode,
  onViewModeChange,
  className,
}: {
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-1 ${className ?? ""}`}
      data-testid="calendar-view-switcher"
    >
      {VIEW_OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          data-view={mode}
          className={`rounded-lg px-4 py-2 text-sm font-black transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] md:py-2 ${
            viewMode === mode
              ? "bg-[#1D4ED8] text-white shadow-sm"
              : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]"
          }`}
          onClick={() => onViewModeChange(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function CalendarToolbar({
  viewMode,
  title,
  onViewModeChange,
  onPrev,
  onNext,
  onToday,
  monthPickerValue,
  onMonthPickerChange,
}: CalendarToolbarProps) {
  const monthInputRef = useRef<HTMLInputElement>(null);
  const showMonthPicker = viewMode === "month" && monthPickerValue && onMonthPickerChange;

  return (
    <div className="mb-4 flex flex-col gap-3" dir="rtl">
      {showMonthPicker && (
        <input
          ref={monthInputRef}
          type="month"
          value={monthPickerValue}
          onChange={(event) => onMonthPickerChange!(event.target.value)}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          tabIndex={-1}
          aria-hidden
        />
      )}

      <div className="hidden items-center justify-between gap-4 md:flex">
        <ViewSwitcher viewMode={viewMode} onViewModeChange={onViewModeChange} className="shrink-0" />

        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-2">
          {showMonthPicker && (
            <button
              type="button"
              className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#1D4ED8] transition duration-150 hover:bg-[#EFF6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] focus-visible:ring-offset-1"
              aria-label="בחר חודש"
              onClick={() => monthInputRef.current?.showPicker?.() ?? monthInputRef.current?.click()}
            >
              <Calendar className="h-4 w-4" />
            </button>
          )}
          <h2 className="truncate text-center text-lg font-black text-[#111827]">{title}</h2>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className={navBtnClass} onClick={onPrev} aria-label="הקודם">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" className={todayBtnClass} onClick={onToday}>
            היום
          </button>
          <button type="button" className={navBtnClass} onClick={onNext} aria-label="הבא">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        <ViewSwitcher
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          className="flex w-full [&>button]:flex-1 [&>button]:py-2.5"
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className={navBtnClass} onClick={onPrev} aria-label="הקודם">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" className={todayBtnClass} onClick={onToday}>
              היום
            </button>
            <button type="button" className={navBtnClass} onClick={onNext} aria-label="הבא">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {showMonthPicker && (
              <button
                type="button"
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-xl border border-[#E5E7EB] bg-white text-[#1D4ED8] transition duration-150 hover:bg-[#EFF6FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]"
                aria-label="בחר חודש"
                onClick={() => monthInputRef.current?.showPicker?.() ?? monthInputRef.current?.click()}
              >
                <Calendar className="h-4 w-4" />
              </button>
            )}
            <h2 className="truncate text-base font-black text-[#111827]">{title}</h2>
          </div>
        </div>
      </div>
    </div>
  );
}
