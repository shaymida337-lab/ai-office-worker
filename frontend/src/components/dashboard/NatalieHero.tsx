"use client";

import { colors, radius, shadow, button, dashboardHome } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

const DEFAULT_HEADLINE = "נטלי עובדת בשבילך";
const DEFAULT_SUBHEADLINE = "מנהלת את המיילים, החשבוניות והמשימות של העסק שלך.";

export function NatalieHero({
  ownerFirstName,
  humanMessage,
  statusLabel = "מחוברת ועובדת עכשיו",
  ctaLabel = "שאל את נטלי",
  scanLabel = "סרוק מייל",
  loading = false,
  scanRunning = false,
  onCta,
  onScan,
}: {
  ownerFirstName?: string | null;
  humanMessage?: string;
  statusLabel?: string;
  ctaLabel?: string;
  scanLabel?: string;
  loading?: boolean;
  scanRunning?: boolean;
  onCta: () => void;
  onScan: () => void;
}) {
  const headline = ownerFirstName ? `בוקר טוב, ${ownerFirstName}. אני כאן.` : DEFAULT_HEADLINE;
  const subheadline = humanMessage?.trim() || DEFAULT_SUBHEADLINE;
  const statusLine = () => (
    <p className={`flex items-center gap-2.5 ${dashboardHome.heroStatus}`}>
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: scanRunning ? colors.warnText : colors.successText }}
        aria-hidden
      />
      <span style={{ color: scanRunning ? colors.warnText : colors.successText }}>
        {scanRunning ? "סורקת מיילים עכשיו" : statusLabel}
      </span>
    </p>
  );

  const ctaRow = () => (
    <div className="grid grid-cols-2 gap-3 md:max-w-md">
      <button
        type="button"
        onClick={onCta}
        className={`${radius.control} ${button.secondary} ${dashboardHome.heroButton} w-full min-h-[52px]`}
        style={{
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          color: colors.textPrimary,
        }}
      >
        {ctaLabel}
      </button>
      <button
        type="button"
        onClick={onScan}
        className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} w-full min-h-[52px]`}
        style={{
          backgroundColor: colors.accent,
          border: `1px solid ${colors.accent}`,
          color: colors.surface,
        }}
      >
        {scanLabel}
      </button>
    </div>
  );

  return (
    <section
      className={`${radius.card} ${shadow.soft} border md:min-h-[340px]`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="נטלי — עובדת המשרד שלך"
    >
      {/* Mobile — premium employee card */}
      <div className="space-y-5 p-6 md:hidden">
        <div className="flex items-start gap-4">
          <NataliePortrait size="heroMobile" showStatusDot={!scanRunning && !loading} />
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
          ctaRow()
        )}
      </div>

      {/* Desktop — portrait right, content left */}
      <div className="hidden min-h-[340px] items-center gap-6 p-6 md:flex lg:gap-8 lg:p-7">
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
            <div className="pt-2">{ctaRow()}</div>
          )}
        </div>

        <div className="order-1 shrink-0 self-center">
          <NataliePortrait size="heroDesktop" showStatusDot={!scanRunning && !loading} />
        </div>
      </div>
    </section>
  );
}
