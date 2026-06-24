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

  const statusLine = (compact = false) => (
    <p className={`flex items-center gap-1.5 font-semibold ${compact ? "text-xs leading-4" : "text-sm leading-5"}`}>
      <span
        className={`inline-block shrink-0 rounded-full ${compact ? "h-1.5 w-1.5" : "h-2 w-2"}`}
        style={{ backgroundColor: scanRunning ? colors.warnText : colors.successText }}
        aria-hidden
      />
      <span style={{ color: scanRunning ? colors.warnText : colors.successText }}>
        {scanRunning ? "סורקת מסמכים עכשיו" : statusLabel}
      </span>
    </p>
  );

  const ctaRow = (compact = false) => (
    <div className={`grid grid-cols-2 ${compact ? "gap-2" : "gap-2 sm:flex sm:flex-row"}`}>
      <button
        type="button"
        onClick={onScan}
        className={`${radius.control} ${button.primary} w-full font-bold ${compact ? "min-h-[36px] px-2 text-xs" : "min-h-[44px] flex-1 px-4 text-sm sm:min-h-[48px] sm:text-base"}`}
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
        className={`${radius.control} ${button.secondary} w-full font-bold ${compact ? "min-h-[36px] px-2 text-xs" : "min-h-[44px] flex-1 px-4 text-sm sm:min-h-[48px] sm:text-base"}`}
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
      className={`${radius.card} ${shadow.soft} border md:max-h-[320px] md:overflow-hidden`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="נטלי — עובדת המשרד שלך"
    >
      {/* Mobile — employee card, max ~180px */}
      <div className="max-h-[180px] overflow-hidden p-3 md:hidden">
        <div className="flex items-center gap-2.5">
          <NataliePortrait size="micro" showStatusDot={!scanRunning && !loading} />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-extrabold leading-tight" style={{ color: colors.textPrimary }}>
              נטלי
            </h1>
            <p className="text-xs font-semibold leading-4" style={{ color: colors.textSecondary }}>
              עובדת המשרד שלך
            </p>
            {!loading && <div className="mt-0.5">{statusLine(true)}</div>}
          </div>
        </div>
        {loading ? (
          <p className="mt-2 text-xs font-medium leading-5" style={{ color: colors.textSecondary }}>
            טוען...
          </p>
        ) : (
          <div className="mt-2">{ctaRow(true)}</div>
        )}
      </div>

      {/* Desktop — portrait right, content left, ~280–320px */}
      <div className="hidden items-center gap-5 p-5 md:flex lg:gap-6 lg:p-6">
        <div className="order-2 min-w-0 flex-1 text-right">
          <p className="text-sm font-bold leading-5" style={{ color: colors.accent }}>
            {greeting}
          </p>
          <h1 className="text-[32px] font-extrabold leading-tight tracking-tight lg:text-[36px]" style={{ color: colors.textPrimary }}>
            נטלי
          </h1>
          <p className="text-base font-semibold leading-6" style={{ color: colors.textSecondary }}>
            עובדת המשרד שלך
          </p>
          {!loading && statusLine()}
          {loading ? (
            <p className="text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
              רגע, אני מסכמת את הבוקר שלך...
            </p>
          ) : (
            <>
              <p className="line-clamp-2 max-w-xl text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
                {humanMessage}
              </p>
              <div className="pt-1">{ctaRow()}</div>
            </>
          )}
        </div>

        <div className="order-1 shrink-0">
          <NataliePortrait size="heroDesktop" showStatusDot={!scanRunning && !loading} />
        </div>
      </div>
    </section>
  );
}
