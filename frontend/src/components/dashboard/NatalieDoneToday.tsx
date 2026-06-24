"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

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
      <h2 className="mb-2.5 text-lg font-bold leading-snug md:text-xl" style={{ color: colors.textPrimary }}>
        מה נטלי כבר עשתה היום
      </h2>

      <div
        className={`${radius.card} ${shadow.soft} border p-4 md:p-5`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
        {loading ? (
          <div className="grid gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg" style={{ backgroundColor: colors.bgSoft }} />
            ))}
          </div>
        ) : showFallback ? (
          <p className={`${typography.body} text-sm leading-7`} style={{ color: colors.textSecondary }}>
            {fallbackText ?? "מחכה לנתונים ראשונים מהעסק שלך"}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={`${radius.control} flex items-start gap-2.5 border p-3`}
                style={{ backgroundColor: colors.successBg, borderColor: colors.successBorder }}
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colors.successText }} strokeWidth={2.4} />
                <span className="text-sm font-semibold leading-6" style={{ color: colors.textPrimary }}>
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
