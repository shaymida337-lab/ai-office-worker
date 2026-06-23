import type { ReactNode } from "react";
import { colors, radius, shadow, spacing, type } from "@/lib/design-tokens";

export type AccuracyMetricTone = "good" | "warn" | "bad" | "neutral";

const toneStyles: Record<
  AccuracyMetricTone,
  { text: string; bg: string; border: string }
> = {
  good: {
    text: colors.successText,
    bg: colors.successBg,
    border: colors.successBorder,
  },
  warn: {
    text: colors.warnText,
    bg: colors.warnBg,
    border: colors.warnBorder,
  },
  bad: {
    text: colors.dangerText,
    bg: colors.dangerBg,
    border: colors.dangerBorder,
  },
  neutral: {
    text: colors.textPrimary,
    bg: colors.surface,
    border: colors.border,
  },
};

export function AccuracyMetricCard({
  title,
  value,
  subtitle,
  tone = "neutral",
}: {
  title: ReactNode;
  value: ReactNode;
  subtitle?: ReactNode;
  tone?: AccuracyMetricTone;
}) {
  const palette = toneStyles[tone];

  return (
    <section
      className={`${radius.card} ${shadow.card} ${spacing.card} min-h-[120px]`}
      style={{
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className={`${type.meta} truncate font-semibold`} style={{ color: colors.textMuted }}>
        {title}
      </div>
      <div className="mt-2 text-2xl font-bold md:text-3xl" style={{ color: palette.text }}>
        {value}
      </div>
      {subtitle ? (
        <div className={`${type.body} mt-2`} style={{ color: colors.textSecondary }}>
          {subtitle}
        </div>
      ) : null}
    </section>
  );
}

export function AccuracySection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-4">
        <h2 className={type.sectionTitle} style={{ color: colors.textPrimary }}>
          {title}
        </h2>
        {description ? (
          <p className={`${type.body} mt-1`} style={{ color: colors.textSecondary }}>
            {description}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 md:gap-4">
        {children}
      </div>
    </section>
  );
}
