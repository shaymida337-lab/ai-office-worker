"use client";

import { colors, radius, shadow, button, dashboardHome } from "@/lib/design-tokens";
import type { HeroStatusTone } from "@/lib/dashboard/heroTrust";
import { NataliePortrait } from "./NataliePortrait";

const DEFAULT_HEADLINE = "נטלי עובדת בשבילך";
const DEFAULT_SUBHEADLINE = "מנהלת את המיילים, החשבוניות והמשימות של העסק שלך.";

const statusToneColors: Record<HeroStatusTone, string> = {
  success: colors.successText,
  warn: colors.warnText,
  danger: colors.dangerText,
  info: colors.infoText,
  neutral: colors.textSecondary,
};

export function NatalieHero({
  ownerFirstName,
  humanMessage,
  statusLabel,
  statusTone = "neutral",
  ctaLabel = "שאל את נטלי",
  loading = false,
  onCta,
}: {
  ownerFirstName?: string | null;
  humanMessage?: string;
  statusLabel: string;
  statusTone?: HeroStatusTone;
  ctaLabel?: string;
  loading?: boolean;
  onCta: () => void;
}) {
  const headline = ownerFirstName ? `בוקר טוב, ${ownerFirstName}. אני כאן.` : DEFAULT_HEADLINE;
  const subheadline = humanMessage?.trim() || DEFAULT_SUBHEADLINE;
  const statusColor = statusToneColors[statusTone];

  const statusLine = () => (
    <p className={`flex items-center gap-2.5 ${dashboardHome.heroStatus}`}>
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: statusColor }}
        aria-hidden
      />
      <span style={{ color: statusColor }}>{statusLabel}</span>
    </p>
  );

  const primaryCta = () => (
    <button
      type="button"
      onClick={onCta}
      disabled={loading}
      className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} w-full min-h-[52px] md:max-w-sm`}
      style={{
        backgroundColor: colors.accent,
        border: `1px solid ${colors.accent}`,
        color: colors.surface,
      }}
    >
      {ctaLabel}
    </button>
  );

  return (
    <section
      className={`${radius.card} ${shadow.soft} border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="נטלי — עובדת המשרד שלך"
    >
      <div className="space-y-5 p-6 md:hidden">
        <div className="flex items-start gap-4">
          <NataliePortrait size="heroMobile" showStatusDot={statusTone === "success" && !loading} />
          <div className="min-w-0 flex-1 space-y-2.5 text-right">
            <h1 className={dashboardHome.heroGreeting} style={{ color: colors.textPrimary }}>
              {ownerFirstName ? `היי, ${ownerFirstName}` : "נטלי"}
            </h1>
            <p className={dashboardHome.heroBody} style={{ color: colors.textSecondary }}>
              {subheadline}
            </p>
            {!loading && statusLine()}
          </div>
        </div>
        {loading ? (
          <p className={dashboardHome.heroBody} style={{ color: colors.textSecondary }}>
            טוען...
          </p>
        ) : (
          primaryCta()
        )}
      </div>

      <div className="hidden items-center gap-6 p-6 md:flex lg:gap-8 lg:p-7">
        <div className="order-2 flex min-w-0 flex-1 flex-col justify-center space-y-3 text-right">
          <h1 className={dashboardHome.heroGreeting} style={{ color: colors.textPrimary }}>
            {headline}
          </h1>
          <p className={`${dashboardHome.heroBody} max-w-xl`} style={{ color: colors.textSecondary }}>
            {subheadline}
          </p>
          {!loading && statusLine()}
          {loading ? (
            <p className={dashboardHome.heroBody} style={{ color: colors.textSecondary }}>
              רגע, אני מסכמת את הבוקר שלך...
            </p>
          ) : (
            <div className="pt-2">{primaryCta()}</div>
          )}
        </div>

        <div className="order-1 shrink-0 self-center">
          <NataliePortrait size="heroDesktop" showStatusDot={statusTone === "success" && !loading} />
        </div>
      </div>
    </section>
  );
}
