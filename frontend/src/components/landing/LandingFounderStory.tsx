import { LANDING_FOUNDER } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export function LandingFounderStorySection() {
  return (
    <section className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="למה בנינו את נטלי">
      <div className="mx-auto max-w-3xl">
        <div
          className={`${radius.card} border ${shadow.soft} p-6 sm:p-8`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <p className="page-kicker">{LANDING_FOUNDER.kicker}</p>
          <h2 className={`${typography.h2} mb-4`} style={{ color: colors.textPrimary }}>
            {LANDING_FOUNDER.title}
          </h2>
          <p className="text-base font-medium leading-8" style={{ color: colors.textSecondary }}>
            {LANDING_FOUNDER.story}
          </p>
          <p className="mt-4 text-sm font-bold" style={{ color: colors.textPrimary }}>
            {LANDING_FOUNDER.signature}
          </p>
        </div>
      </div>
    </section>
  );
}
