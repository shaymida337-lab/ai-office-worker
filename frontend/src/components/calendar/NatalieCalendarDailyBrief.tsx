"use client";

import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { Button, KpiCard, Skeleton } from "@/components/natalie-ui";
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
      className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[var(--natalie-card-border,#DBE5F4)] bg-[var(--natalie-card-bg,#ffffff)] shadow-sm"
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
                <Skeleton className="h-10 w-2/3 max-w-sm" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : (
              <>
                <div>
                  <h1 className="break-words text-2xl font-black text-[var(--natalie-text-primary,#0F172A)] md:text-3xl">
                    {brief.greeting}
                  </h1>
                  <p className="mt-1 text-base font-semibold text-[#6B7280]">{brief.dateLabel}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {brief.stats.map((stat) => (
                    <KpiCard key={stat.id} label={stat.label} value={stat.value} />
                  ))}
                </div>

                <div className="space-y-2">
                  {brief.summaryLines.map((line) => (
                    <p key={line} className="break-words text-base font-medium text-[#4B5563]">
                      {line}
                    </p>
                  ))}
                  <p
                    data-testid="calendar-brief-recommendation"
                    className="break-words text-base font-semibold text-[var(--natalie-text-primary,#0F172A)]"
                  >
                    {brief.recommendation}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        {!loading && (
          <Button variant="primary" onClick={onAskNatalie} className="w-full sm:max-w-sm">
            שאלי את נטלי על היומן
          </Button>
        )}
      </div>
    </section>
  );
}
