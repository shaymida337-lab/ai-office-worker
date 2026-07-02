"use client";

import { colors, radius, dashboardHome } from "@/lib/design-tokens";
import { NatalieCommandBar } from "./NatalieCommandBar";

export function NatalieSmartSuggestions({
  suggestions,
  onSubmit,
  onScan,
  onConnect,
}: {
  suggestions: string[];
  onSubmit: (value: string) => void;
  onScan?: () => void;
  onConnect?: () => void;
}) {
  return (
    <section className="dashboard-fade-in space-y-3" aria-label="הצעות חכמות מנטלי">
      <div className="text-right">
        <h2 className={dashboardHome.sectionTitle} style={{ color: colors.textPrimary }}>
          מה תרצה שאעשה?
        </h2>
        <p className={`mt-1 ${dashboardHome.sectionSubtitle}`} style={{ color: colors.textSecondary }}>
          אפשר לבקש ממני ישירות — אני אתאים את עצמי למה שקורה בעסק
        </p>
      </div>

      <ul className="flex flex-wrap justify-end gap-2">
        {suggestions.map((suggestion, index) => (
          <li key={suggestion} className="dashboard-chip-in" style={{ animationDelay: `${index * 40}ms` }}>
            <button
              type="button"
              onClick={() => {
                if (suggestion.includes("חבר")) {
                  onConnect?.();
                  return;
                }
                if (suggestion.includes("סרק") || suggestion.includes("התקדמות")) {
                  onScan?.();
                  return;
                }
                onSubmit(suggestion);
              }}
              className={`${radius.pill} min-h-[44px] border px-4 py-2 ${dashboardHome.prompt}`}
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.borderSubtle,
                color: colors.textPrimary,
              }}
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>

      <NatalieCommandBar onSubmit={onSubmit} onScan={onScan} suggestions={[]} />
    </section>
  );
}
