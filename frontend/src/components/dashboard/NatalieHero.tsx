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
      <div className="mb-4 flex justify-end">
        <NataliePortrait size="avatar" />
      </div>

      <h1
        className="text-[30px] font-extrabold leading-[1.12] tracking-tight md:text-[40px]"
        style={{ color: colors.textPrimary }}
      >
        {greeting} 👋
      </h1>

      {loading ? (
        <p className="mt-4 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
          רגע, אני מסכמת את הבוקר שלך...
        </p>
      ) : (
        <>
          {showCompleted && !isScanning && (
            <div className="mt-4">
              <p className="text-base font-semibold leading-7" style={{ color: colors.textSecondary }}>
                בזמן שלא היית:
              </p>
              <ul className="mt-2 grid gap-1.5">
                {completedLines.map((line) => (
                  <li key={line.id} className="flex items-center justify-end gap-2.5">
                    <span
                      className="text-lg font-semibold leading-8 md:text-xl md:leading-8"
                      style={{ color: colors.textPrimary }}
                    >
                      {line.text}
                    </span>
                    <Check
                      className="h-[18px] w-[18px] shrink-0"
                      style={{ color: colors.successText }}
                      strokeWidth={2.5}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isScanning && (
            <p className="mt-4 text-lg font-medium leading-8" style={{ color: colors.textSecondary }}>
              {completedLines[0]?.text}
            </p>
          )}

          {!isScanning && completedLines[0]?.id === "ready" && (
            <p className="mt-4 text-lg font-medium leading-8" style={{ color: colors.textSecondary }}>
              {completedLines[0].text}
            </p>
          )}

          {decisionCount > 0 && (
            <p
              className="mt-4 text-[22px] font-bold leading-snug md:text-2xl"
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
              className={`${radius.control} ${button.primary} mt-4 w-full md:w-auto md:min-w-[220px]`}
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
