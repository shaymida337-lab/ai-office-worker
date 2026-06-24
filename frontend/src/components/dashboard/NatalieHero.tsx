"use client";

import { Check } from "lucide-react";
import type { HeroSummaryLine } from "@/lib/dashboard/home";
import { colors, radius, button } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

const MAX_COMPLETED_LINES = 3;

export function NatalieHero({
  greeting,
  completedLines,
  statusLabel = "עובדת בשבילך עכשיו",
  ctaLabel = "מה חשוב עכשיו",
  loading = false,
  onCta,
}: {
  greeting: string;
  completedLines: HeroSummaryLine[];
  statusLabel?: string;
  ctaLabel?: string;
  loading?: boolean;
  onCta: () => void;
}) {
  const showCompleted = completedLines.length > 0 && completedLines[0]?.id !== "ready";
  const isScanning = completedLines[0]?.id === "scanning";
  const visibleCompleted = completedLines.slice(0, MAX_COMPLETED_LINES);

  return (
    <section className="text-right" aria-label="נטלי — העובדת הדיגיטלית שלך">
      <div className="flex items-start gap-3">
        <NataliePortrait size="avatar" showStatusDot={!isScanning} />
        <div className="min-w-0 flex-1">
          <h1
            className="text-[28px] font-extrabold leading-[1.15] tracking-tight md:text-[36px]"
            style={{ color: colors.textPrimary }}
          >
            {greeting}
          </h1>
          {!loading && (
            <p
              className="mt-1 flex items-center justify-end gap-1.5 text-sm font-semibold leading-6"
              style={{ color: colors.successText }}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: isScanning ? colors.warnText : colors.successText }}
                aria-hidden
              />
              {isScanning ? "סורקת מסמכים עבורך" : statusLabel}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <p className="mt-3 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
          רגע, אני מסכמת את הבוקר שלך...
        </p>
      ) : (
        <>
          {showCompleted && !isScanning && (
            <ul className="mt-3 grid gap-1">
              {visibleCompleted.map((line) => (
                <li key={line.id} className="flex items-center justify-end gap-2">
                  <span
                    className="text-[15px] font-medium leading-6 md:text-base md:leading-7"
                    style={{ color: colors.textSecondary }}
                  >
                    {line.text}
                  </span>
                  <Check
                    className="h-3.5 w-3.5 shrink-0"
                    style={{ color: colors.successText }}
                    strokeWidth={2.5}
                  />
                </li>
              ))}
            </ul>
          )}

          {isScanning && (
            <p className="mt-3 text-[15px] font-medium leading-6" style={{ color: colors.textSecondary }}>
              {completedLines[0]?.text}
            </p>
          )}

          {!isScanning && completedLines[0]?.id === "ready" && (
            <p className="mt-3 text-[15px] font-medium leading-6" style={{ color: colors.textSecondary }}>
              {completedLines[0].text}
            </p>
          )}

          <button
            type="button"
            onClick={onCta}
            className={`${radius.control} ${button.primary} mt-4 min-h-[48px] w-full md:min-h-[52px] md:w-auto md:min-w-[200px]`}
            style={{
              backgroundColor: colors.accent,
              border: `1px solid ${colors.accent}`,
              color: colors.surface,
            }}
          >
            {ctaLabel}
          </button>
        </>
      )}
    </section>
  );
}
