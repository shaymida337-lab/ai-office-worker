"use client";

import { colors, radius, shadow, button, dashboardHome } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

export function NatalieMorningBrief({
  greeting,
  recommendation,
  ctaLabel = "שאל את נטלי",
  loading = false,
  onCta,
}: {
  greeting: string;
  recommendation: string;
  ctaLabel?: string;
  loading?: boolean;
  onCta: () => void;
}) {
  const primaryCta = () => (
    <button
      type="button"
      onClick={onCta}
      disabled={loading}
      className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} w-full min-h-[52px] max-w-full transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.99] md:max-w-sm`}
      style={{
        backgroundColor: colors.accent,
        border: `1px solid ${colors.accent}`,
        color: colors.surface,
        outlineColor: colors.surface,
      }}
    >
      {ctaLabel}
    </button>
  );

  return (
    <section
      className={`dashboard-fade-in ${radius.card} ${shadow.soft} max-w-full overflow-hidden border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="תדרוך בוקר מנטלי"
      data-testid="natalie-morning-brief"
    >
      <div className="space-y-5 p-4 sm:p-5 md:hidden">
        <div className="flex min-w-0 flex-col items-center gap-4 text-center">
          <NataliePortrait size="heroMobile" />
          <div className="min-w-0 w-full space-y-3 text-right">
            <h1
              className="break-words text-[24px] font-bold leading-[1.25] tracking-tight sm:text-[28px]"
              style={{ color: colors.textPrimary }}
            >
              {greeting}
            </h1>
            {loading ? (
              <div
                className="dashboard-shimmer h-14 w-full rounded-2xl"
                style={{ backgroundColor: colors.bgSoft }}
                aria-hidden
              />
            ) : (
              <p
                data-testid="hero-recommendation"
                className="break-words text-[18px] font-medium leading-relaxed sm:text-[21px]"
                style={{ color: colors.textSecondary }}
              >
                {recommendation}
              </p>
            )}
          </div>
        </div>

        {loading ? (
          <p className={`${dashboardHome.heroBody} break-words`} style={{ color: colors.textSecondary }}>
            רגע, אני מסכמת את הבוקר שלך...
          </p>
        ) : (
          primaryCta()
        )}
      </div>

      <div className="hidden min-w-0 p-6 md:block lg:p-7">
        <div className="flex min-w-0 items-start gap-6 lg:gap-8">
          <div className="shrink-0">
            <NataliePortrait size="heroDesktop" />
          </div>
          <div className="min-w-0 flex-1 space-y-5 text-right">
            <div className="space-y-3">
              <h1 className={`${dashboardHome.heroGreeting} break-words`} style={{ color: colors.textPrimary }}>
                {greeting}
              </h1>
              {loading ? (
                <div
                  className="dashboard-shimmer h-16 max-w-2xl rounded-2xl"
                  style={{ backgroundColor: colors.bgSoft }}
                  aria-hidden
                />
              ) : (
                <p
                  data-testid="hero-recommendation"
                  className={`${dashboardHome.heroBody} max-w-2xl break-words leading-relaxed`}
                  style={{ color: colors.textSecondary }}
                >
                  {recommendation}
                </p>
              )}
            </div>

            {loading ? (
              <p className={dashboardHome.heroBody} style={{ color: colors.textSecondary }}>
                רגע, אני מסכמת את הבוקר שלך...
              </p>
            ) : (
              <div className="pt-1">{primaryCta()}</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** @deprecated Use NatalieMorningBrief */
export const NatalieHero = NatalieMorningBrief;
