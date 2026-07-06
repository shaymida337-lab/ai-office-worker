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
