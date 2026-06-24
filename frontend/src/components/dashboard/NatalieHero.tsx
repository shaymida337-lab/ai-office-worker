"use client";

import { Check } from "lucide-react";
import type { HeroSummaryLine } from "@/lib/dashboard/home";
import { colors, radius, button } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

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
      <div className="flex items-start gap-3 md:gap-4">
        <NataliePortrait size="avatar" className="mt-1" />
        <div className="min-w-0 flex-1">
          <h1
            className="text-[32px] font-extrabold leading-[1.1] tracking-tight md:text-[40px]"
            style={{ color: colors.textPrimary }}
          >
            {greeting} 👋
          </h1>
        </div>
      </div>

      {loading ? (
        <p className="mt-3 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
          רגע, אני מסכמת את הבוקר שלך...
        </p>
      ) : (
        <>
          {showCompleted && !isScanning && (
            <div className="mt-3">
              <p className="text-base font-bold leading-7" style={{ color: colors.textSecondary }}>
                בזמן שלא היית:
              </p>
              <ul className="mt-1.5 grid gap-0.5">
                {completedLines.map((line) => (
                  <li key={line.id} className="flex items-center justify-end gap-2">
                    <span className="text-lg font-semibold leading-8" style={{ color: colors.textPrimary }}>
                      {line.text}
                    </span>
                    <Check
                      className="h-4 w-4 shrink-0"
                      style={{ color: colors.successText }}
                      strokeWidth={2.5}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isScanning && (
            <p className="mt-3 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              {completedLines[0]?.text}
            </p>
          )}

          {!isScanning && completedLines[0]?.id === "ready" && (
            <p className="mt-3 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              {completedLines[0].text}
            </p>
          )}

          {decisionCount > 0 && (
            <p
              className="mt-3 text-xl font-bold leading-snug md:text-2xl"
              style={{ color: colors.textPrimary }}
            >
              {decisionCount === 1
                ? "אני צריכה ממך רק החלטה אחת."
                : `אני צריכה ממך רק ${decisionCount} החלטות.`}
            </p>
          )}

          {ctaLabel && (
            <button
              type="button"
              onClick={onCta}
              className={`${radius.control} ${button.primary} mt-4 w-full sm:w-auto sm:min-w-[200px]`}
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
