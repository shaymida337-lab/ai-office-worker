"use client";

import { CheckCircle2 } from "lucide-react";
import { colors, radius, shadow, button, dashboardHome } from "@/lib/design-tokens";
import type { HeroStatusTone } from "@/lib/dashboard/heroTrust";
import type { AlreadyWorkedItem } from "@/lib/dashboard/alreadyWorked";
import { NataliePortrait } from "./NataliePortrait";

const statusToneColors: Record<HeroStatusTone, string> = {
  success: colors.successText,
  warn: colors.warnText,
  danger: colors.dangerText,
  info: colors.infoText,
  neutral: colors.textSecondary,
};

export function NatalieMorningBrief({
  greeting,
  leadIn,
  statusLabel,
  statusTone = "neutral",
  ctaLabel = "שאל את נטלי",
  loading = false,
  workItems = [],
  emptyWorkMessage,
  workLoading = false,
  onCta,
}: {
  greeting: string;
  leadIn: string;
  statusLabel: string;
  statusTone?: HeroStatusTone;
  ctaLabel?: string;
  loading?: boolean;
  workItems?: AlreadyWorkedItem[];
  emptyWorkMessage?: string;
  workLoading?: boolean;
  onCta: () => void;
}) {
  const statusColor = statusToneColors[statusTone];
  const hasWork = workItems.length > 0;

  const statusLine = () => (
    <p className="flex min-w-0 items-start gap-2.5 text-[17px] font-semibold leading-snug sm:text-[20px]">
      <span
        className="mt-1.5 inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: statusColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 break-words" style={{ color: statusColor }}>
        {statusLabel}
      </span>
    </p>
  );

  const primaryCta = () => (
    <button
      type="button"
      onClick={onCta}
      disabled={loading}
      className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} w-full min-h-[52px] max-w-full md:max-w-sm`}
      style={{
        backgroundColor: colors.accent,
        border: `1px solid ${colors.accent}`,
        color: colors.surface,
      }}
    >
      {ctaLabel}
    </button>
  );

  const workSection = () => {
    if (workLoading) {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="dashboard-shimmer h-10 w-full rounded-full"
              style={{ backgroundColor: colors.bgSoft }}
            />
          ))}
        </div>
      );
    }

    if (!hasWork) {
      return (
        <p
          className={`${dashboardHome.sectionSubtitle} dashboard-fade-in break-words text-[18px] leading-snug sm:text-[21px]`}
          style={{ color: colors.textSecondary }}
        >
          {emptyWorkMessage ?? "ברגע שאתחיל לעבוד, אעדכן אותך כאן."}
        </p>
      );
    }

    return (
      <ul className="grid gap-2 sm:grid-cols-2">
        {workItems.map((item, index) => (
          <li
            key={item.id}
            className={`dashboard-chip-in ${radius.pill} flex min-w-0 items-center gap-2 border px-3 py-2.5`}
            style={{
              backgroundColor: colors.successBg,
              borderColor: colors.successBorder,
              animationDelay: `${index * 60}ms`,
            }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: colors.successText }} strokeWidth={2.4} />
            <span className={`${dashboardHome.listItem} min-w-0 break-words text-[17px] leading-snug sm:text-[21px]`} style={{ color: colors.textPrimary }}>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section
      className={`dashboard-fade-in ${radius.card} ${shadow.soft} max-w-full overflow-hidden border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="תדרוך בוקר מנטלי"
      data-testid="natalie-morning-brief"
    >
      <div className="space-y-4 p-4 sm:p-5 md:hidden">
        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
          <NataliePortrait size="heroMobile" showStatusDot={statusTone === "success" && !loading} />
          <div className="min-w-0 w-full space-y-2 text-right">
            <h1
              className="break-words text-[24px] font-bold leading-[1.25] tracking-tight sm:text-[28px]"
              style={{ color: colors.textPrimary }}
            >
              {greeting}
            </h1>
            <p className="break-words text-[18px] font-medium leading-snug sm:text-[21px]" style={{ color: colors.textSecondary }}>
              {leadIn}
            </p>
            {!loading && statusLine()}
          </div>
        </div>

        <div className="min-w-0 space-y-2.5">
          <p className={`${dashboardHome.actionLabel} text-[19px] sm:text-[21px]`} style={{ color: colors.textPrimary }}>
            מה כבר עשיתי
          </p>
          {workSection()}
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
            <NataliePortrait size="heroDesktop" showStatusDot={statusTone === "success" && !loading} />
          </div>
          <div className="min-w-0 flex-1 space-y-4 text-right">
            <div className="space-y-2">
              <h1 className={`${dashboardHome.heroGreeting} break-words`} style={{ color: colors.textPrimary }}>
                {greeting}
              </h1>
              <p className={`${dashboardHome.heroBody} max-w-2xl break-words`} style={{ color: colors.textSecondary }}>
                {leadIn}
              </p>
              {!loading && statusLine()}
            </div>

            <div className="space-y-2.5">
              <p className={dashboardHome.sectionTitle} style={{ color: colors.textPrimary }}>
                מה כבר עשיתי
              </p>
              {workSection()}
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
