"use client";

import { colors, radius, shadow, button } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

export function NatalieHero({
  ownerFirstName,
  humanMessage,
  statusLabel = "מחוברת ועובדת עכשיו",
  ctaLabel = "שאל את נטלי",
  scanLabel = "סרוק מסמך",
  loading = false,
  scanRunning = false,
  onCta,
  onScan,
}: {
  ownerFirstName?: string | null;
  humanMessage: string;
  statusLabel?: string;
  ctaLabel?: string;
  scanLabel?: string;
  loading?: boolean;
  scanRunning?: boolean;
  onCta: () => void;
  onScan: () => void;
}) {
  const greeting = ownerFirstName ? `שלום ${ownerFirstName} 👋` : "שלום 👋";

  const statusLine = (
    <p className="flex items-center gap-1.5 text-sm font-semibold leading-5">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: scanRunning ? colors.warnText : colors.successText }}
        aria-hidden
      />
      <span style={{ color: scanRunning ? colors.warnText : colors.successText }}>
        {scanRunning ? "סורקת מסמכים עבורך עכשיו" : statusLabel}
      </span>
    </p>
  );

  const ctaRow = (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={onScan}
        className={`${radius.control} ${button.primary} min-h-[44px] flex-1 px-4 text-sm font-bold sm:min-h-[48px] sm:text-base`}
        style={{
          backgroundColor: colors.accent,
          border: `1px solid ${colors.accent}`,
          color: colors.surface,
        }}
      >
        {scanLabel}
      </button>
      <button
        type="button"
        onClick={onCta}
        className={`${radius.control} ${button.secondary} min-h-[44px] flex-1 px-4 text-sm font-bold sm:min-h-[48px] sm:text-base`}
        style={{
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          color: colors.textPrimary,
        }}
      >
        {ctaLabel}
      </button>
    </div>
  );

  return (
    <section
      className={`${radius.card} ${shadow.soft} border p-4 md:p-6 lg:p-7`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="נטלי — עובדת המשרד שלך"
    >
      {/* Mobile — compact horizontal */}
      <div className="flex items-start gap-3 md:hidden">
        <NataliePortrait size="compact" showStatusDot={!scanRunning && !loading} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-bold leading-5" style={{ color: colors.accent }}>
            {greeting}
          </p>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight" style={{ color: colors.textPrimary }}>
            נטלי
          </h1>
          <p className="text-sm font-semibold leading-5" style={{ color: colors.textSecondary }}>
            עובדת המשרד שלך
          </p>
          {!loading && statusLine}
          {!loading && (
            <p className="line-clamp-2 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
              {humanMessage}
            </p>
          )}
          {!loading && <div className="pt-1">{ctaRow}</div>}
        </div>
      </div>

      {/* Desktop — portrait + content */}
      <div className="hidden items-center gap-6 md:grid md:grid-cols-12 lg:gap-8">
        <div className="md:col-span-4 lg:col-span-3">
          <NataliePortrait size="hero" showStatusDot={!scanRunning && !loading} className="mx-auto max-w-[280px] md:mx-0 lg:max-w-[300px]" />
        </div>

        <div className="min-w-0 space-y-3 md:col-span-8 lg:col-span-9">
          <p className="text-base font-bold leading-6" style={{ color: colors.accent }}>
            {greeting}
          </p>
          <h1 className="text-[44px] font-extrabold leading-[1.05] tracking-tight lg:text-[52px]" style={{ color: colors.textPrimary }}>
            נטלי
          </h1>
          <p className="text-xl font-semibold leading-7" style={{ color: colors.textSecondary }}>
            עובדת המשרד שלך
          </p>
          {!loading && statusLine}
          {loading ? (
            <p className="text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              רגע, אני מסכמת את הבוקר שלך...
            </p>
          ) : (
            <>
              <p className="max-w-2xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
                {humanMessage}
              </p>
              <div className="pt-1">{ctaRow}</div>
            </>
          )}
        </div>
      </div>

      {loading && (
        <p className="mt-3 text-sm font-medium leading-6 md:hidden" style={{ color: colors.textSecondary }}>
          רגע, אני מסכמת את הבוקר שלך...
        </p>
      )}
    </section>
  );
}
