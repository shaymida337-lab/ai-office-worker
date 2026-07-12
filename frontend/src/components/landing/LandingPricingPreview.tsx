import { LANDING_PRICING_PREVIEW } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export function LandingPricingPreviewSection() {
  return (
    <section id="pricing" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="מחיר">
      <div className="mx-auto max-w-3xl">
        <div
          className={`${radius.card} border ${shadow.soft} p-6 text-center sm:p-8`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <p className="page-kicker">{LANDING_PRICING_PREVIEW.kicker}</p>
          <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
            {LANDING_PRICING_PREVIEW.title}
          </h2>
          <p className="mx-auto max-w-xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
            {LANDING_PRICING_PREVIEW.lead}
          </p>

          <ul className="mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-semibold" style={{ color: colors.textSecondary }}>
            {LANDING_PRICING_PREVIEW.points.map((point) => (
              <li key={point} className="flex items-center gap-1.5">
                <span style={{ color: colors.successText }} aria-hidden>
                  ✓
                </span>
                {point}
              </li>
            ))}
          </ul>

          <div className="mt-7">
            <a href={LANDING_PRICING_PREVIEW.ctaHref} className="btn w-full sm:w-auto">
              {LANDING_PRICING_PREVIEW.cta}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
