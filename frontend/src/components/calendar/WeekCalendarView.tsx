"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/natalie-ui";
import { natalie } from "@/components/natalie-ui/tokens";
import { useOrganizationTimezone } from "@/hooks/useOrganizationTimezone";
import { useI18n } from "@/i18n";
import {
  TIMELINE_END_HOUR,
  TIMELINE_START_HOUR,
  appointmentStatusBorderColor,
  colorWithAlpha,
  formatAppointmentTime,
  formatHourLabel,
  getMinutesFromMidnight,
  getTimelineHours,
  isSameCalendarDay,
  layoutDayAppointments,
  toDateInputValue,
  type TimelineAppointment,
} from "@/lib/calendarUtils";
import { openNatalieAssistant } from "@/lib/calendar/openNatalieAssistant";
import { calendarUi, weekColumnClass } from "./calendarUi";
import { CalendarEventCard, type CalendarEventCardAppointment } from "./CalendarEventCard";

const DAY_NAMES = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

/** Time-grid density: 1.2px per minute -> 30 min = 36px, hour = 72px. */
const WEEK_PX_PER_MINUTE = 1.2;
const HOUR_PX = 60 * WEEK_PX_PER_MINUTE;
const GRID_HEIGHT_PX = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * HOUR_PX;

type WeekCalendarViewProps<T extends CalendarEventCardAppointment> = {
  weekDays: Date[];
  appointments: T[];
  loading: boolean;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
  onSelectAppointment: (appointment: T) => void;
  onQuickConfirm?: (appointment: T) => void;
};

function googleSyncShortLabel(
  status: CalendarEventCardAppointment["googleSyncStatus"] | undefined,
  t: (key: string) => string
): string | null {
  switch (status) {
    case "synced":
      return t("calendar.googleSynced");
    case "pending":
      return t("calendar.googlePending");
    case "failed":
      return t("calendar.googleFailed");
    case "retrying":
      return t("calendar.googleRetrying");
    default:
      return null;
  }
}

/** דקות שחלפו מאז 07:00 בציר של היום — או null כשמחוץ לטווח התצוגה. */
function nowOffsetMinutes(now: Date): number | null {
  const minutes = getMinutesFromMidnight(now);
  const start = TIMELINE_START_HOUR * 60;
  const end = TIMELINE_END_HOUR * 60;
  if (minutes < start || minutes > end) return null;
  return minutes - start;
}

export function WeekCalendarView<T extends CalendarEventCardAppointment>({
  weekDays,
  appointments,
  loading,
  statusLabel,
  statusTone,
  onSelectAppointment,
  onQuickConfirm,
}: WeekCalendarViewProps<T>) {
  const { t } = useI18n();
  const orgTimezone = useOrganizationTimezone();
  const hours = getTimelineHours();

  // קו "עכשיו" מתעדכן פעם בדקה כדי לא להיתקע על זמן הרינדור הראשון.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const nowOffset = nowOffsetMinutes(now);

  const positionedByDay = useMemo(
    () =>
      weekDays.map((day) =>
        layoutDayAppointments(appointments, day, { pxPerMinute: WEEK_PX_PER_MINUTE })
      ),
    [appointments, weekDays]
  );

  if (loading) {
    return <div className="skeleton min-h-[280px] rounded-2xl sm:min-h-[380px]" />;
  }

  return (
    <>
      {/* Desktop (lg+): Time Grid מקצועי 07:00–21:00 */}
      <div className={`hidden lg:block ${calendarUi.gridShell}`} data-testid="calendar-week-grid">
        <div className="max-h-[min(76vh,680px)] overflow-y-auto overscroll-contain">
          <div dir="rtl">
            {/* שורת כותרות ימים — דביקה בזמן גלילה */}
            <div className="sticky top-0 z-30 flex border-b border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface-elevated,#F8FAFF)]">
              <div className="w-12 shrink-0 sm:w-14" />
              {weekDays.map((day, index) => {
                const isToday = isSameCalendarDay(day, now);
                return (
                  <div
                    key={toDateInputValue(day)}
                    className={`flex-1 border-s border-[var(--natalie-border,#D9E2F2)] px-1 py-1.5 text-center ${
                      isToday ? "bg-[#1D4ED8]/[0.07]" : ""
                    }`}
                  >
                    <div className={`text-xs font-black ${isToday ? "text-[#1D4ED8] dark:text-[#93C5FD]" : natalie.title}`}>
                      {DAY_NAMES[index]}
                    </div>
                    <div className={`text-[11px] font-semibold ${isToday ? "text-[#1D4ED8] dark:text-[#93C5FD]" : natalie.subtitle}`}>
                      {day.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: orgTimezone })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex">
              {/* ציר שעות */}
              <div className="relative w-12 shrink-0 sm:w-14" style={{ height: GRID_HEIGHT_PX }}>
                {hours.map((hour) => (
                  <div key={hour} className={calendarUi.timelineRulerLabel} style={{ height: HOUR_PX }}>
                    <span dir="ltr">{formatHourLabel(hour)}</span>
                  </div>
                ))}
                <div className={`flex h-0 items-start justify-center pt-1 text-[10px] font-bold ${natalie.subtitle} sm:text-xs`}>
                  <span dir="ltr">{formatHourLabel(TIMELINE_END_HOUR)}</span>
                </div>
              </div>

              {/* 7 עמודות ימים */}
              {weekDays.map((day, dayIndex) => {
                const isToday = isSameCalendarDay(day, now);
                const blocks = positionedByDay[dayIndex] ?? [];

                return (
                  <div
                    key={toDateInputValue(day)}
                    className={`relative min-w-0 flex-1 border-s border-[var(--natalie-border,#D9E2F2)] ${
                      isToday ? "bg-[#1D4ED8]/[0.05] dark:bg-[#3B82F6]/[0.10]" : ""
                    }`}
                    style={{ height: GRID_HEIGHT_PX }}
                  >
                    {/* קווי שעה + חצי שעה */}
                    {hours.map((hour, index) => (
                      <div key={hour}>
                        <div
                          className="pointer-events-none absolute inset-x-0 border-t border-[var(--natalie-border,#D9E2F2)]"
                          style={{ top: index * HOUR_PX }}
                        />
                        <div
                          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--natalie-border,#D9E2F2)] opacity-45"
                          style={{ top: index * HOUR_PX + HOUR_PX / 2 }}
                        />
                      </div>
                    ))}

                    {/* קו "עכשיו" — רק ביום הנוכחי */}
                    {isToday && nowOffset !== null && (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-20"
                        style={{ top: nowOffset * WEEK_PX_PER_MINUTE }}
                        data-testid="week-grid-now-line"
                      >
                        <div className="relative border-t-2 border-[#EF4444]/70">
                          <span className="absolute -top-[5px] end-0 h-2 w-2 rounded-full bg-[#EF4444]" />
                        </div>
                      </div>
                    )}

                    {/* תורים ממוקמים לפי זמן אמיתי; חופפים — זה לצד זה */}
                    {blocks.map((block) => {
                      const appt = block.appointment;
                      const widthPercent = 100 / block.columnCount;
                      const rightPercent = block.columnIndex * widthPercent;
                      return (
                        <WeekGridEventBlock
                          key={appt.id}
                          appointment={appt}
                          heightPx={block.heightPx}
                          topPx={block.topPx}
                          rightPercent={rightPercent}
                          widthPercent={widthPercent}
                          statusLabel={statusLabel}
                          statusTone={statusTone}
                          orgTimezone={orgTimezone}
                          onSelect={() => onSelectAppointment(appt)}
                          t={t}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <p className={`${calendarUi.timelineFooter} px-3 pb-2`}>
          שעות {formatHourLabel(TIMELINE_START_HOUR)}–{formatHourLabel(TIMELINE_END_HOUR)}
        </p>
      </div>

      {/* מתחת ל-lg: הפריסה הקיימת נשארת כפי שהיא (מובייל/טאבלט ללא שינוי) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden" dir="rtl">
        {weekDays.map((day, index) => {
          const key = toDateInputValue(day);
          const dayAppts = appointments
            .filter((appt) => toDateInputValue(new Date(appt.startTime)) === key)
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          const isToday = isSameCalendarDay(day, now);

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
                        backgroundColor: colorWithAlpha(appt.employee?.color || appt.service?.color || "#3B82F6", 0.1),
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * בלוק תור קומפקטי ל-Time Grid: הגובה נגזר מהמשך בלבד (בלי מינימום מעוות),
 * והתוכן נחשף בהדרגה לפי הגובה הזמין. לחיצה פותחת את חלון הפרטים הקיים.
 */
function WeekGridEventBlock<T extends CalendarEventCardAppointment>({
  appointment,
  topPx,
  heightPx,
  rightPercent,
  widthPercent,
  statusLabel,
  statusTone,
  orgTimezone,
  onSelect,
  t,
}: {
  appointment: T;
  topPx: number;
  heightPx: number;
  rightPercent: number;
  widthPercent: number;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => "success" | "warn" | "danger" | "info" | "neutral";
  orgTimezone?: string;
  onSelect: () => void;
  t: (key: string) => string;
}) {
  const rawName = appointment.client?.name?.trim() ?? "";
  const clientName = rawName.length >= 2 ? rawName : t("calendar.unidentifiedClient");
  const isCancelled = appointment.status === "cancelled";
  const color = appointment.employee?.color || appointment.service?.color || "#3B82F6";
  const statusAccent = appointmentStatusBorderColor(appointment.status);
  const time = formatAppointmentTime(appointment.startTime, orgTimezone);
  const googleLabel = googleSyncShortLabel(appointment.googleSyncStatus, t);

  const showTimeLine = heightPx >= 34;
  const showDetailsLine = heightPx >= 60 && Boolean(appointment.service?.name || appointment.employee?.name);
  const showBadges = heightPx >= 84;

  const detailsLine = [appointment.service?.name, appointment.employee?.name].filter(Boolean).join(" · ");
  const tooltip = `${clientName} · ${time} · ${appointment.durationMinutes} ${t("calendar.minutesShort")}${
    detailsLine ? ` · ${detailsLine}` : ""
  } · ${statusLabel(appointment.status)}`;

  const toneClass: Record<ReturnType<typeof statusTone>, string> = {
    success: "bg-[#ECFDF5] text-[#065F46]",
    info: "bg-[#EFF6FF] text-[#1E40AF]",
    warn: "bg-[#FFFBEB] text-[#92400E]",
    danger: "bg-[#FEF2F2] text-[#991B1B]",
    neutral: "bg-[#F1F5F9] text-[#475569]",
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      title={tooltip}
      data-testid="week-grid-event"
      className={`absolute z-10 overflow-hidden rounded-md border border-s-[3px] px-1.5 py-0.5 text-right transition hover:z-20 hover:brightness-[0.97] focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1D4ED8] ${
        isCancelled ? "opacity-55" : ""
      }`}
      style={{
        top: topPx,
        height: heightPx,
        right: `calc(${rightPercent}% + 2px)`,
        width: `calc(${widthPercent}% - 4px)`,
        backgroundColor: colorWithAlpha(color, 0.16),
        borderColor: colorWithAlpha(color, 0.32),
        borderInlineStartColor: statusAccent,
      }}
    >
      <div
        className={`truncate text-[11px] font-black leading-[14px] text-[var(--natalie-text-primary,#0F172A)] ${
          isCancelled ? "line-through" : ""
        }`}
      >
        {clientName}
      </div>
      {showTimeLine && (
        <div className="truncate text-[10px] font-bold leading-[13px] text-[var(--natalie-text-muted,#64748B)]" dir="ltr">
          {time} · {appointment.durationMinutes} {t("calendar.minutesShort")}
        </div>
      )}
      {showDetailsLine && (
        <div className="truncate text-[10px] font-semibold leading-[13px] text-[var(--natalie-text-muted,#64748B)]">
          {detailsLine}
        </div>
      )}
      {showBadges && (
        <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
          <span className={`rounded-full px-1.5 py-px text-[9px] font-bold ${toneClass[statusTone(appointment.status)]}`}>
            {statusLabel(appointment.status)}
          </span>
          {googleLabel && (
            <span className="rounded-full bg-[#F1F5F9] px-1.5 py-px text-[9px] font-bold text-[#475569]">{googleLabel}</span>
          )}
        </div>
      )}
    </button>
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
