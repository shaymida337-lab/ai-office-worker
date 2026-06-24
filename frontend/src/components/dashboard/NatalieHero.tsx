"use client";

import { CheckCircle2 } from "lucide-react";
import type { HeroSummaryLine } from "@/lib/dashboard/home";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

export function NatalieHero({
  greeting,
  workCount,
  summaryLines,
  ctaLabel,
  loading = false,
  onCta,
}: {
  greeting: string;
  workCount: number;
  summaryLines: HeroSummaryLine[];
  ctaLabel: string;
  loading?: boolean;
  onCta: () => void;
}) {
  const headline =
    workCount === 0
      ? "אני נטלי."
      : workCount === 1
        ? "אני נטלי.\nטיפלתי הבוקר בדבר אחד עבורך."
        : `אני נטלי.\nטיפלתי הבוקר ב-${workCount} דברים עבורך.`;

  return (
    <section
      className={`${radius.lg} relative overflow-hidden border p-4 md:p-5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 20px 56px rgba(15,23,42,0.1)",
        backgroundImage:
          "linear-gradient(135deg, rgba(29,91,255,0.1) 0%, rgba(255,255,255,0) 50%, rgba(109,40,217,0.08) 100%)",
      }}
      aria-label="נטלי — העובדת המשרדית שלך"
    >
      <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
        <div
          className={`${radius.lg} relative min-h-[420px] overflow-hidden`}
          style={{
            background:
              "radial-gradient(circle at 18% 18%, rgba(29,91,255,0.28) 0%, rgba(29,91,255,0.06) 40%, rgba(255,255,255,0) 78%)",
          }}
        >
          <NataliePortrait size="hero" className="h-full max-w-none rounded-[20px]" />
        </div>

        <div
          className={`${radius.lg} flex min-w-0 flex-1 flex-col justify-between border p-5 text-right md:p-6`}
          style={{
            backgroundColor: "rgba(255,255,255,0.9)",
            borderColor: colors.borderSubtle,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
          }}
        >
          <div>
            <p className={`${typography.h1} leading-tight`} style={{ color: colors.textPrimary }}>
              {greeting} 👋
            </p>

            {loading ? (
              <p className={`${typography.subtitle} mt-3 leading-8`} style={{ color: colors.textSecondary }}>
                רגע, אני מסכמת את הבוקר שלך...
              </p>
            ) : (
              <>
                <p
                  className={`${typography.subtitle} mt-3 whitespace-pre-line leading-8`}
                  style={{ color: colors.textPrimary }}
                >
                  {headline}
                </p>

                {summaryLines.length > 0 && (
                  <ul className="mt-4 grid gap-1.5">
                    {summaryLines.map((line) => (
                      <li key={line.id} className="flex items-start gap-2.5">
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0"
                          style={{ color: colors.successText }}
                          strokeWidth={2.5}
                        />
                        <span className={`${typography.body} leading-7`} style={{ color: colors.textSecondary }}>
                          {line.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {ctaLabel && (
            <button
              type="button"
              onClick={onCta}
              className={`${radius.control} ${button.primary} mt-5 w-full`}
              style={{
                backgroundColor: colors.accent,
                border: `1px solid ${colors.accent}`,
                color: colors.surface,
                boxShadow: "0 14px 32px rgba(29,91,255,0.24)",
              }}
            >
              {ctaLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
