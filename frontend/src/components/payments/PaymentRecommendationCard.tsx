"use client";

import { colors, radius, button, type as typography } from "@/lib/design-tokens";
import type { PaymentRecommendation } from "@/lib/payments/types";

export function PaymentRecommendationCard({
  recommendation,
  onAction,
}: {
  recommendation: PaymentRecommendation;
  onAction: () => void;
}) {
  if (recommendation.kind === "all_clear") return null;

  return (
    <section
      className={`${radius.lg} border p-5 md:p-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300`}
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.accent,
        boxShadow: "0 12px 36px rgba(29,91,255,0.12)",
      }}
      aria-label="המלצת נטלי"
    >
      <p className={`${typography.caption} font-bold`} style={{ color: colors.accent }}>
        נטלי ממליצה
      </p>
      <h2 className={`${typography.sectionTitle} mt-2 leading-snug`} style={{ color: colors.textPrimary }}>
        {recommendation.title}
      </h2>
      <p className={`${typography.body} mt-2 leading-7`} style={{ color: colors.textSecondary }}>
        {recommendation.reason}
      </p>
      <button
        type="button"
        onClick={onAction}
        className={`${radius.control} ${button.primary} mt-5 w-full sm:w-auto`}
        style={{
          backgroundColor: colors.accent,
          border: `1px solid ${colors.accent}`,
          color: colors.surface,
          boxShadow: "0 12px 28px rgba(29,91,255,0.22)",
        }}
      >
        {recommendation.ctaLabel}
      </button>
    </section>
  );
}
