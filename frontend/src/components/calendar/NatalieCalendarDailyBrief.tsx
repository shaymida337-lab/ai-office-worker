"use client";

import { colors, radius, shadow, button, dashboardHome } from "@/lib/design-tokens";
import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import type { CalendarDailyBrief } from "@/lib/calendar/calendarBrief";

export function NatalieCalendarDailyBrief({
  brief,
  loading = false,
  onAskNatalie,
}: {
  brief: CalendarDailyBrief | null;
  loading?: boolean;
  onAskNatalie: () => void;
}) {
  return (
    <section
      className={`dashboard-fade-in ${radius.card} ${shadow.soft} min-w-0 max-w-full overflow-hidden border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="תדרוך יומי של נטלי"
      data-testid="natalie-calendar-daily-brief"
    >
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
          <div className="mx-auto shrink-0 sm:mx-0">
            <NataliePortrait size="compact" showStatusDot />
          </div>
          <div className="min-w-0 flex-1 space-y-3 text-right">
            {loading || !brief ? (
              <>
                <div className="dashboard-shimmer h-10 w-2/3 max-w-sm rounded-2xl" style={{ backgroundColor: colors.bgSoft }} />
                <div className="dashboard-shimmer h-16 w-full rounded-2xl" style={{ backgroundColor: colors.bgSoft }} />
              </>
            ) : (
              <>
                <div>
                  <h1 className={`${dashboardHome.heroGreeting} break-words`} style={{ color: colors.textPrimary }}>
                    {brief.greeting}
                  </h1>
                  <p className="mt-1 text-base font-semibold text-[#6B7280]">{brief.dateLabel}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {brief.stats.map((stat) => (
                    <div
                      key={stat.id}
                      className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2.5 text-right"
                    >
                      <div className="text-xs font-semibold text-[#6B7280]">{stat.label}</div>
                      <div className="mt-0.5 text-lg font-black text-[#111827]">{stat.value}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  {brief.summaryLines.map((line) => (
                    <p key={line} className={`${dashboardHome.heroBody} break-words`} style={{ color: colors.textSecondary }}>
                      {line}
                    </p>
                  ))}
                  <p
                    data-testid="calendar-brief-recommendation"
                    className={`${dashboardHome.heroBody} break-words font-semibold`}
                    style={{ color: colors.textPrimary }}
                  >
                    {brief.recommendation}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {!loading && (
          <button
            type="button"
            onClick={onAskNatalie}
            className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} w-full min-h-[52px] transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.99] sm:max-w-sm`}
            style={{
              backgroundColor: colors.accent,
              border: `1px solid ${colors.accent}`,
              color: colors.surface,
              outlineColor: colors.surface,
            }}
          >
            בקש מנטלי
          </button>
        )}
      </div>
    </section>
  );
}
