import { NataliePortrait } from "@/components/dashboard/NataliePortrait";
import { HERO_ACTIVITY_CHECKLIST, HERO_QUICK_BENEFITS } from "@/components/billing/plans/plansContent";
import { LANDING_HERO } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export function LandingHero() {
  return (
    <section className="overflow-x-hidden px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-10" aria-label="נטלי — עובדת המשרד שלך">
      <div
        className={`mx-auto max-w-6xl ${radius.card} border ${shadow.soft} overflow-hidden`}
        style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
      >
        <div className="grid gap-8 p-5 sm:p-7 md:grid-cols-2 md:items-center md:gap-10 lg:p-8">
          <div className="order-2 min-w-0 text-right md:order-1">
            <p className="page-kicker">{LANDING_HERO.kicker}</p>
            <h1 className={`${typography.h1} mb-0`} style={{ color: colors.textPrimary }}>
              {LANDING_HERO.headline}
            </h1>
            <p className={`mt-4 max-w-xl ${typography.subtitle}`} style={{ color: colors.textSecondary }}>
              {LANDING_HERO.subtitle}
            </p>

            <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold" style={{ color: colors.textSecondary }}>
              {HERO_QUICK_BENEFITS.map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <span style={{ color: colors.successText }} aria-hidden>
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a href="#waitlist" className="btn w-full sm:w-auto">
                {LANDING_HERO.cta}
              </a>
              <a href="#features" className="btn btn-secondary w-full sm:w-auto">
                {LANDING_HERO.secondaryCta}
              </a>
            </div>
          </div>

          <div className="order-1 mx-auto grid w-full max-w-[320px] min-w-0 gap-4 md:order-2 md:mx-0 md:max-w-none">
            <div className="relative mx-auto w-full max-w-[240px] md:mx-0 md:max-w-[260px]">
              <div className="pt-2 md:pt-0">
                <NataliePortrait size="hero" showStatusDot />
              </div>
              <div
                className={`mt-3 ${radius.lg} border px-3 py-2 text-center text-xs font-semibold sm:text-sm md:absolute md:-top-1 md:mt-0 md:max-w-[12rem] md:text-right ${shadow.soft} md:-left-3 md:px-4 md:py-2.5`}
                style={{
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                  color: colors.textPrimary,
                }}
                role="note"
              >
                {LANDING_HERO.bubble}
              </div>
            </div>

            <div
              className={`${radius.lg} border p-4`}
              style={{ backgroundColor: colors.accentMuted, borderColor: colors.borderSubtle }}
            >
              <p className="mb-3 text-xs font-bold uppercase tracking-wide" style={{ color: colors.accent }}>
                פעילות חיה
              </p>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1">
                {HERO_ACTIVITY_CHECKLIST.slice(0, 6).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm leading-6" style={{ color: colors.textSecondary }}>
                    <span className="mt-0.5 shrink-0 font-bold" style={{ color: colors.successText }} aria-hidden>
                      ✓
                    </span>
                    <span className="min-w-0 break-words">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
