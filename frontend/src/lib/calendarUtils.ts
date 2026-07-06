export const TIMELINE_START_HOUR = 7;
export const TIMELINE_END_HOUR = 21;
export const PX_PER_MINUTE = 1.25;
export const MIN_APPOINTMENT_BLOCK_PX = 28;

export type DayBounds = {
  from: Date;
  to: Date;
};

export type TimelineAppointment = {
  id: string;
  startTime: string;
  durationMinutes: number;
  status: string;
  client: { name: string };
  service?: { name: string; color?: string | null } | null;
};

export type PositionedTimelineAppointment<T extends TimelineAppointment = TimelineAppointment> = {
  appointment: T;
  topPx: number;
  heightPx: number;
  columnIndex: number;
  columnCount: number;
};

export function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function getDayBounds(date: Date): DayBounds {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export function getAppointmentDayKey(startTimeIso: string): string {
  return toDateInputValue(new Date(startTimeIso));
}

export function getMinutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function formatDayLabel(date: Date, timeZone?: string): string {
  const formatted = date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
  if (isSameCalendarDay(date, new Date())) {
    return `היום — ${formatted}`;
  }
  return formatted;
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function getTimelineHeightPx(
  startHour = TIMELINE_START_HOUR,
  endHour = TIMELINE_END_HOUR,
  pxPerMinute = PX_PER_MINUTE
): number {
  return (endHour - startHour) * 60 * pxPerMinute;
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(59, 130, 246, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type Interval<T> = {
  appointment: T;
  start: number;
  end: number;
};

function clusterOverlappingIntervals<T>(intervals: Interval<T>[]): Interval<T>[][] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: Interval<T>[][] = [];
  let currentCluster: Interval<T>[] = [];
  let clusterEnd = -Infinity;

  for (const interval of sorted) {
    if (currentCluster.length === 0 || interval.start < clusterEnd) {
      currentCluster.push(interval);
      clusterEnd = Math.max(clusterEnd, interval.end);
      continue;
    }
    clusters.push(currentCluster);
    currentCluster = [interval];
    clusterEnd = interval.end;
  }

  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  return clusters;
}

function assignColumnsInCluster<T>(cluster: Interval<T>[]): Array<Interval<T> & { columnIndex: number }> {
  const columnEnds: number[] = [];
  const placed: Array<Interval<T> & { columnIndex: number }> = [];

  for (const interval of cluster) {
    let columnIndex = columnEnds.findIndex((end) => end <= interval.start);
    if (columnIndex === -1) {
      columnIndex = columnEnds.length;
      columnEnds.push(interval.end);
    } else {
      columnEnds[columnIndex] = interval.end;
    }
    placed.push({ ...interval, columnIndex });
  }

  return placed;
}

export function layoutDayAppointments<T extends TimelineAppointment>(
  appointments: T[],
  selectedDay: Date,
  options?: {
    dayStartHour?: number;
    dayEndHour?: number;
    pxPerMinute?: number;
  }
): PositionedTimelineAppointment<T>[] {
  const dayStartHour = options?.dayStartHour ?? TIMELINE_START_HOUR;
  const dayEndHour = options?.dayEndHour ?? TIMELINE_END_HOUR;
  const pxPerMinute = options?.pxPerMinute ?? PX_PER_MINUTE;
  const dayKey = toDateInputValue(selectedDay);
  const timelineStartMinutes = dayStartHour * 60;

  const dayAppointments = appointments.filter(
    (appt) => getAppointmentDayKey(appt.startTime) === dayKey
  );

  const intervals: Interval<T>[] = dayAppointments.map((appointment) => {
    const startDate = new Date(appointment.startTime);
    const start = getMinutesFromMidnight(startDate);
    const end = start + appointment.durationMinutes;
    return { appointment, start, end };
  });

  const positioned: PositionedTimelineAppointment<T>[] = [];

  for (const cluster of clusterOverlappingIntervals(intervals)) {
    const withColumns = assignColumnsInCluster(cluster);
    const columnCount = Math.max(...withColumns.map((item) => item.columnIndex), 0) + 1;

    for (const item of withColumns) {
      const rawTop = (item.start - timelineStartMinutes) * pxPerMinute;
      const rawHeight = Math.max((item.end - item.start) * pxPerMinute, MIN_APPOINTMENT_BLOCK_PX);
      positioned.push({
        appointment: item.appointment,
        topPx: rawTop,
        heightPx: rawHeight,
        columnIndex: item.columnIndex,
        columnCount,
      });
    }
  }

  return positioned.sort(
    (a, b) => a.topPx - b.topPx || a.appointment.startTime.localeCompare(b.appointment.startTime)
  );
}

export function getTimelineHours(startHour = TIMELINE_START_HOUR, endHour = TIMELINE_END_HOUR): number[] {
  return Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
}

export type CalendarViewMode = "day" | "week" | "month";

export const DAY_NAMES_SHORT = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"] as const;

const STATUS_BORDER_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  confirmed: "#3B82F6",
  completed: "#10B981",
  cancelled: "#EF4444",
  no_show: "#6B7280",
};

export type MonthAppointmentSummary = {
  id: string;
  startTime: string;
  clientName: string;
  status: string;
  serviceColor: string;
};

export function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function getMonthBounds(monthAnchor: Date): DayBounds {
  const from = startOfMonth(monthAnchor);
  const to = addMonths(from, 1);
  return { from, to };
}

export function buildMonthGrid(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function formatMonthTitle(monthAnchor: Date, timeZone?: string): string {
  return monthAnchor.toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatAppointmentTime(startTimeIso: string, timeZone?: string): string {
  return new Date(startTimeIso).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function appointmentStatusBorderColor(status: string): string {
  return STATUS_BORDER_COLORS[status] ?? "#94A3B8";
}

export function toAppointmentMonthSummary(appointment: TimelineAppointment): MonthAppointmentSummary {
  return {
    id: appointment.id,
    startTime: appointment.startTime,
    clientName: appointment.client.name,
    status: appointment.status,
    serviceColor: appointment.service?.color || "#3B82F6",
  };
}

export function sliceMonthDayAppointments<T>(appointments: T[], maxVisible: number): { visible: T[]; overflowCount: number } {
  if (appointments.length <= maxVisible) {
    return { visible: appointments, overflowCount: 0 };
  }
  return {
    visible: appointments.slice(0, maxVisible),
    overflowCount: appointments.length - maxVisible,
  };
}

export type AppointmentInterval = {
  id: string;
  clientName: string;
  startMinutes: number;
  endMinutes: number;
  status: string;
};

export function toAppointmentInterval(
  appointment: TimelineAppointment,
  dayKey: string
): AppointmentInterval | null {
  if (getAppointmentDayKey(appointment.startTime) !== dayKey) return null;
  const startDate = new Date(appointment.startTime);
  const startMinutes = getMinutesFromMidnight(startDate);
  return {
    id: appointment.id,
    clientName: appointment.client.name,
    startMinutes,
    endMinutes: startMinutes + appointment.durationMinutes,
    status: appointment.status,
  };
}

export function findSchedulingConflicts(appointments: TimelineAppointment[], dayKey: string): Array<{ a: string; b: string; clientA: string; clientB: string }> {
  const active = appointments
    .map((appt) => toAppointmentInterval(appt, dayKey))
    .filter((item): item is AppointmentInterval => item !== null && item.status !== "cancelled");

  const conflicts: Array<{ a: string; b: string; clientA: string; clientB: string }> = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i]!;
      const right = active[j]!;
      if (left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes) {
        conflicts.push({
          a: left.id,
          b: right.id,
          clientA: left.clientName,
          clientB: right.clientName,
        });
      }
    }
  }
  return conflicts;
}

export function computeFreeMinutesToday(
  appointments: TimelineAppointment[],
  dayKey: string,
  workStartHour = 8,
  workEndHour = 18
): number {
  const workStart = workStartHour * 60;
  const workEnd = workEndHour * 60;
  const busy = appointments
    .map((appt) => toAppointmentInterval(appt, dayKey))
    .filter((item): item is AppointmentInterval => item !== null && item.status !== "cancelled")
    .sort((a, b) => a.startMinutes - b.startMinutes);

  if (busy.length === 0) return workEnd - workStart;

  let free = 0;
  let cursor = workStart;
  for (const block of busy) {
    const start = Math.max(block.startMinutes, workStart);
    const end = Math.min(block.endMinutes, workEnd);
    if (start > cursor) free += start - cursor;
    cursor = Math.max(cursor, end);
  }
  if (cursor < workEnd) free += workEnd - cursor;
  return Math.max(0, free);
}
