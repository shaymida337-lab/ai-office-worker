"use client";

import { memo } from "react";
import {
  appointmentStatusBorderColor,
  colorWithAlpha,
  formatAppointmentTime,
  type MonthAppointmentSummary,
} from "@/lib/calendarUtils";

type MonthAppointmentPillProps = {
  appointment: MonthAppointmentSummary;
  compact?: boolean;
  onSelect: (id: string) => void;
};

export const MonthAppointmentPill = memo(function MonthAppointmentPill({
  appointment,
  compact = false,
  onSelect,
}: MonthAppointmentPillProps) {
  const isCancelled = appointment.status === "cancelled";
  const time = formatAppointmentTime(appointment.startTime);
  const statusColor = appointmentStatusBorderColor(appointment.status);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(appointment.id);
      }}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent border-s-[3px] px-1.5 py-1 text-right transition duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] ${
        compact ? "min-h-7 text-[11px]" : "min-h-7 text-[11px] sm:min-h-8 sm:text-xs"
      } ${isCancelled ? "opacity-50" : ""}`}
      style={{
        backgroundColor: colorWithAlpha(appointment.serviceColor, 0.18),
        borderInlineStartColor: statusColor,
      }}
      title={`${time} ${appointment.clientName}`}
    >
      <span className={`shrink-0 font-black text-[#111827] ${isCancelled ? "line-through" : ""}`} dir="ltr">
        {time}
      </span>
      <span className={`min-w-0 truncate font-bold text-[#374151] ${isCancelled ? "line-through" : ""}`}>
        {appointment.clientName}
      </span>
    </button>
  );
});
