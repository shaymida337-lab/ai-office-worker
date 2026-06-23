import { Sparkles } from "lucide-react";
import type { NatalieRecommendation } from "@/lib/natalie/types";
import { colors, radius, button, type } from "@/lib/design-tokens";

export function NatalieRecommendationCard({
  recommendation,
  onAction,
}: {
  recommendation: NatalieRecommendation;
  onAction: () => void;
}) {
  if (recommendation.kind === "all_clear") return null;

  return (
    <section
      className={`border-t border-b py-6`}
      style={{ borderColor: colors.borderSubtle }}
      aria-label="המלצת נטלי"
    >
      <div className="flex gap-3">
        <span
          className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
        >
          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`${type.caption} font-semibold`} style={{ color: colors.accent }}>
            אני ממליצה שנתחיל בזה:
          </p>
          <h2 className={`${type.sectionTitle} mt-2 leading-snug`} style={{ color: colors.textPrimary }}>
            {recommendation.title}
          </h2>
          <p className={`${type.body} mt-2 leading-7`} style={{ color: colors.textSecondary }}>
            {recommendation.reason}
          </p>
          <button
            type="button"
            onClick={onAction}
            className={`${radius.control} ${button.primary} mt-5 w-full sm:w-auto sm:min-w-[220px]`}
            style={{
              backgroundColor: colors.accent,
              border: `1px solid ${colors.accent}`,
              color: colors.surface,
            }}
          >
            {recommendation.ctaLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
