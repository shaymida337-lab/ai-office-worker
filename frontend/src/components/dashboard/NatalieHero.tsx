"use client";

import { Check } from "lucide-react";
import type { HeroSummaryLine } from "@/lib/dashboard/home";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";

export function NatalieHero({
  greeting,
  completedLines,
  decisionCount,
  ctaLabel,
  loading = false,
  onCta,
}: {
  greeting: string;
  completedLines: HeroSummaryLine[];
  decisionCount: number;
  ctaLabel: string;
  loading?: boolean;
  onCta: () => void;
}) {
  const showCompleted = completedLines.length > 0 && completedLines[0]?.id !== "ready";
  const isScanning = completedLines[0]?.id === "scanning";

  return (
    <section className="text-right" aria-label="תדרוך בוקר מנטלי">
      <p className={`${typography.h1} leading-tight`} style={{ color: colors.textPrimary }}>
        {greeting} 👋
      </p>

      {loading ? (
        <p className={`${typography.body} mt-4 leading-7`} style={{ color: colors.textSecondary }}>
          רגע, אני מסכמת את הבוקר שלך...
        </p>
      ) : (
        <>
          {showCompleted && !isScanning && (
            <div className="mt-5">
              <p className={`${typography.body} font-semibold leading-7`} style={{ color: colors.textSecondary }}>
                בזמן שלא היית:
              </p>
              <ul className="mt-2 grid gap-1">
                {completedLines.map((line) => (
                  <li key={line.id} className="flex items-start justify-end gap-2.5">
                    <span className={`${typography.body} leading-7`} style={{ color: colors.textPrimary }}>
                      {line.text}
                    </span>
                    <Check
                      className="mt-1 h-4 w-4 shrink-0"
                      style={{ color: colors.successText }}
                      strokeWidth={2.5}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isScanning && (
            <p className={`${typography.body} mt-4 leading-7`} style={{ color: colors.textSecondary }}>
              {completedLines[0]?.text}
            </p>
          )}

          {!isScanning && completedLines[0]?.id === "ready" && (
            <p className={`${typography.body} mt-4 leading-7`} style={{ color: colors.textSecondary }}>
              {completedLines[0].text}
            </p>
          )}

          {decisionCount > 0 && (
            <p className={`${typography.subtitle} mt-5 leading-8`} style={{ color: colors.textPrimary }}>
              {decisionCount === 1
                ? "אני צריכה ממך רק החלטה אחת."
                : `אני צריכה ממך רק ${decisionCount} החלטות.`}
            </p>
          )}

          {ctaLabel && (
            <button
              type="button"
              onClick={onCta}
              className={`${radius.control} ${button.primary} mt-5 w-full sm:w-auto sm:min-w-[220px]`}
              style={{
                backgroundColor: colors.accent,
                border: `1px solid ${colors.accent}`,
                color: colors.surface,
              }}
            >
              {ctaLabel}
            </button>
          )}
        </>
      )}
    </section>
  );
}
