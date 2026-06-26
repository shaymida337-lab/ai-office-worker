"use client";

import { colors, radius, shadow, button } from "@/lib/design-tokens";
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
  const statusLine = (compact = false) => (
    <p className={`flex items-center gap-1.5 font-semibold ${compact ? "text-sm leading-5" : "text-sm leading-5"}`}>
      <span
        className={`inline-block shrink-0 rounded-full ${compact ? "h-2 w-2" : "h-2 w-2"}`}
        style={{ backgroundColor: scanRunning ? colors.warnText : colors.successText }}
        aria-hidden
      />
      <span style={{ color: scanRunning ? colors.warnText : colors.successText }}>
        {scanRunning ? "סורקת מיילים עכשיו" : statusLabel}
      </span>
    </p>
  );

  const ctaRow = (compact = false) => (
    <div className={`grid grid-cols-2 gap-2 ${compact ? "" : "max-w-md"}`}>
      <button
        type="button"
        onClick={onCta}
        className={`${radius.control} ${button.secondary} w-full font-bold ${compact ? "min-h-[44px] px-3 text-sm" : "min-h-[48px] px-4 text-sm"}`}
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
        className={`${radius.control} ${button.primary} w-full font-bold ${compact ? "min-h-[44px] px-3 text-sm" : "min-h-[48px] px-4 text-sm"}`}
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
      {/* Mobile — compact employee card */}
      <div className="p-4 md:hidden">
        <div className="flex items-start gap-3">
          <NataliePortrait size="micro" showStatusDot={!scanRunning && !loading} />
          <div className="min-w-0 flex-1 text-right">
            <h1 className="text-xl font-extrabold leading-snug tracking-tight" style={{ color: colors.textPrimary }}>
              {ownerFirstName ? `היי, ${ownerFirstName}` : "נטלי"}
            </h1>
            <p className="mt-1.5 text-base font-medium leading-7 line-clamp-3" style={{ color: colors.textSecondary }}>
              {subheadline}
            </p>
            {!loading && <div className="mt-2">{statusLine(true)}</div>}
          </div>
        </div>
        {loading ? (
          <p className="mt-3 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
            טוען...
          </p>
        ) : (
          <div className="mt-3">{ctaRow(true)}</div>
        )}
      </div>

      {/* Desktop — portrait right, content left */}
      <div className="hidden min-h-[340px] items-center gap-6 p-6 md:flex lg:gap-8 lg:p-7">
        <div className="order-2 flex min-w-0 flex-1 flex-col justify-center text-right">
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight lg:text-[34px]" style={{ color: colors.textPrimary }}>
            {headline}
          </h1>
          <p className="mt-2 max-w-xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
            {subheadline}
          </p>
          {!loading && <div className="mt-3">{statusLine()}</div>}
          {loading ? (
            <p className="mt-4 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
              רגע, אני מסכמת את הבוקר שלך...
            </p>
          ) : (
            <div className="mt-5">{ctaRow()}</div>
          )}
        </div>

        <div className="order-1 shrink-0 self-center">
          <NataliePortrait size="heroDesktop" showStatusDot={!scanRunning && !loading} />
        </div>
      </div>
    </section>
  );
}
