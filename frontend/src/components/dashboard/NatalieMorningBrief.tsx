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

  const workSection = () => {
    if (workLoading) {
      return (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="dashboard-shimmer h-10 min-w-[10rem] shrink-0 rounded-full"
              style={{ backgroundColor: colors.bgSoft }}
            />
          ))}
        </div>
      );
    }

    if (!hasWork) {
      return (
        <p className={`${dashboardHome.sectionSubtitle} dashboard-fade-in`} style={{ color: colors.textSecondary }}>
          {emptyWorkMessage ?? "ברגע שאתחיל לעבוד, אעדכן אותך כאן."}
        </p>
      );
    }

    return (
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
        {workItems.map((item, index) => (
          <li
            key={item.id}
            className={`dashboard-chip-in ${radius.pill} flex min-w-[10.5rem] shrink-0 items-center gap-2 border px-3 py-2.5 md:min-w-0`}
            style={{
              backgroundColor: colors.successBg,
              borderColor: colors.successBorder,
              animationDelay: `${index * 60}ms`,
            }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: colors.successText }} strokeWidth={2.4} />
            <span className={`${dashboardHome.listItem} whitespace-nowrap md:whitespace-normal`} style={{ color: colors.textPrimary }}>
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section
      className={`dashboard-fade-in ${radius.card} ${shadow.soft} border`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="תדרוך בוקר מנטלי"
    >
      <div className="space-y-4 p-5 md:hidden">
        <div className="flex items-start gap-3.5">
          <NataliePortrait size="heroMobile" showStatusDot={statusTone === "success" && !loading} />
          <div className="min-w-0 flex-1 space-y-2 text-right">
            <h1 className="text-[28px] font-bold leading-[1.2] tracking-tight" style={{ color: colors.textPrimary }}>
              {greeting}
            </h1>
            <p className={`${dashboardHome.sectionSubtitle}`} style={{ color: colors.textSecondary }}>
              {leadIn}
            </p>
            {!loading && statusLine()}
          </div>
        </div>

        <div className="space-y-2.5">
          <p className={`${dashboardHome.actionLabel}`} style={{ color: colors.textPrimary }}>
            מה כבר עשיתי
          </p>
          {workSection()}
        </div>

        {loading ? (
          <p className={dashboardHome.heroBody} style={{ color: colors.textSecondary }}>
            רגע, אני מסכמת את הבוקר שלך...
          </p>
        ) : (
          primaryCta()
        )}
      </div>

      <div className="hidden p-6 md:block lg:p-7">
        <div className="flex items-start gap-6 lg:gap-8">
          <div className="shrink-0">
            <NataliePortrait size="heroDesktop" showStatusDot={statusTone === "success" && !loading} />
          </div>
          <div className="min-w-0 flex-1 space-y-4 text-right">
            <div className="space-y-2">
              <h1 className={dashboardHome.heroGreeting} style={{ color: colors.textPrimary }}>
                {greeting}
              </h1>
              <p className={`${dashboardHome.heroBody} max-w-2xl`} style={{ color: colors.textSecondary }}>
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
