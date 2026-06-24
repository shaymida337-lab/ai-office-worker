"use client";

import { colors, radius, shadow, button } from "@/lib/design-tokens";
import { NataliePortrait } from "./NataliePortrait";

export function NatalieHero({
  ownerFirstName,
  humanMessage,
  statusLabel = "מחוברת ועובדת עכשיו",
  ctaLabel = "מה חשוב עכשיו",
  scanLabel = "📷 סרוק מסמך",
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

  return (
    <section
      className={`${radius.card} ${shadow.card} border p-4 md:p-6 lg:p-8`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      aria-label="נטלי — עובדת המשרד שלך"
    >
      <div className="grid items-center gap-5 md:grid-cols-12 md:gap-6 lg:gap-8">
        <div className="mx-auto w-full max-w-[200px] md:col-span-3 md:mx-0 md:max-w-none lg:col-span-2">
          <NataliePortrait size="hero" showStatusDot={!scanRunning && !loading} className="mx-auto md:mx-0" />
        </div>

        <div className="min-w-0 text-right md:col-span-9 lg:col-span-10">
          <p className="text-sm font-bold leading-6 md:text-base" style={{ color: colors.accent }}>
            {greeting}
          </p>

          <h1
            className="mt-1 text-[36px] font-extrabold leading-[1.05] tracking-tight md:text-[48px] lg:text-[56px]"
            style={{ color: colors.textPrimary }}
          >
            נטלי
          </h1>

          <p className="mt-0.5 text-lg font-semibold leading-7 md:text-xl" style={{ color: colors.textSecondary }}>
            עובדת המשרד שלך
          </p>

          {!loading && (
            <p className="mt-2 flex items-center justify-end gap-1.5 text-sm font-semibold leading-6 md:justify-start md:text-base">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: scanRunning ? colors.warnText : colors.successText }}
                aria-hidden
              />
              <span style={{ color: scanRunning ? colors.warnText : colors.successText }}>
                {scanRunning ? "סורקת מסמכים עבורך עכשיו" : statusLabel}
              </span>
            </p>
          )}

          {loading ? (
            <p className="mt-4 text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              רגע, אני מסכמת את הבוקר שלך...
            </p>
          ) : (
            <>
              <p
                className="mt-4 max-w-2xl text-[15px] font-medium leading-7 md:text-base md:leading-8"
                style={{ color: colors.textSecondary }}
              >
                {humanMessage}
              </p>

              <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={onScan}
                  className={`${radius.control} ${button.primary} min-h-[48px] w-full sm:min-h-[52px] sm:w-auto sm:min-w-[200px]`}
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
                  className={`${radius.control} ${button.secondary} min-h-[48px] w-full sm:min-h-[52px] sm:w-auto sm:min-w-[200px]`}
                  style={{
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                  }}
                >
                  {ctaLabel}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
