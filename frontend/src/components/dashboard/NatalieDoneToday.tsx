"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, shadow, dashboardHome } from "@/lib/design-tokens";

export type DoneTodayItem = {
  id: string;
  text: string;
};

export function NatalieDoneToday({
  items,
  fallbackText,
  loading = false,
}: {
  items: DoneTodayItem[];
  fallbackText?: string;
  loading?: boolean;
}) {
  const showFallback = !loading && items.length === 0;

  return (
    <section aria-label="מה נטלי כבר עשתה היום">
      <h2 className={`mb-3 ${dashboardHome.sectionTitle}`} style={{ color: colors.textPrimary }}>
        מה כבר עשיתי היום
      </h2>

      <div
        className={`${radius.card} ${shadow.soft} border p-3 md:p-5`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
        {loading ? (
          <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:gap-2.5 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 min-w-[9rem] shrink-0 animate-pulse rounded-lg md:min-w-0" style={{ backgroundColor: colors.bgSoft }} />
            ))}
          </div>
        ) : showFallback ? (
          <p className={dashboardHome.sectionSubtitle} style={{ color: colors.textSecondary }}>
            {fallbackText ?? "ברגע שאתחיל לעבוד, אראה כאן מה כבר הספקתי בשבילך היום."}
          </p>
        ) : (
          <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:grid-cols-2 md:gap-2.5 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4">
            {items.map((item) => (
              <li
                key={item.id}
                className={`${radius.control} flex min-w-[11rem] shrink-0 items-center gap-2 border px-3 py-2.5 md:min-w-0`}
                style={{ backgroundColor: colors.successBg, borderColor: colors.successBorder }}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: colors.successText }} strokeWidth={2.4} />
                <span className={`${dashboardHome.listItem} whitespace-nowrap md:whitespace-normal`} style={{ color: colors.textPrimary }}>
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
