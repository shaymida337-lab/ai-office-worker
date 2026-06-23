"use client";

import { colors, radius, button, type as typography } from "@/lib/design-tokens";

type HeroChip = {
  id: string;
  label: string;
  tone: "green" | "orange" | "red" | "neutral";
};

const chipStyles: Record<HeroChip["tone"], { bg: string; color: string; border: string }> = {
  green: { bg: colors.successBg, color: colors.successText, border: colors.successBorder },
  orange: { bg: colors.warnBg, color: colors.warnText, border: colors.warnBorder },
  red: { bg: colors.dangerBg, color: colors.dangerText, border: colors.dangerBorder },
  neutral: { bg: colors.bgSoft, color: colors.textSecondary, border: colors.borderSubtle },
};

export function NatalieHero({
  greeting,
  subtitle,
  chips,
  ctaLabel,
  loading = false,
  onCta,
}: {
  greeting: string;
  subtitle: string;
  chips: HeroChip[];
  ctaLabel: string;
  loading?: boolean;
  onCta: () => void;
}) {
  return (
    <section
      className={`${radius.lg} border p-6 md:p-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.borderSubtle,
        boxShadow: "0 10px 40px rgba(15,23,42,0.06)",
        backgroundImage: "linear-gradient(135deg, rgba(29,91,255,0.04) 0%, rgba(255,255,255,0) 55%)",
      }}
      aria-label="נטלי כבר עבדה בשבילך"
    >
      <h2 className={`${typography.h1} leading-tight`} style={{ color: colors.textPrimary }}>
        {greeting} 👋
      </h2>
        <p className={`${typography.subtitle} mt-3 leading-8`} style={{ color: colors.textSecondary }}>
        {loading ? "רגע, אני מסכמת..." : subtitle}
      </p>

      {!loading && chips.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2">
          {chips.map((chip) => {
            const style = chipStyles[chip.tone];
            return (
              <li key={chip.id}>
                <span
                  className={`inline-flex min-h-[36px] items-center ${radius.pill} border px-3 py-1.5 text-sm font-bold`}
                  style={{ backgroundColor: style.bg, color: style.color, borderColor: style.border }}
                >
                  {chip.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && ctaLabel && (
        <button
          type="button"
          onClick={onCta}
          className={`${radius.control} ${button.primary} mt-6 w-full sm:w-auto sm:min-w-[240px]`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
            boxShadow: "0 12px 28px rgba(29,91,255,0.22)",
          }}
        >
          {ctaLabel}
        </button>
      )}
    </section>
  );
}
