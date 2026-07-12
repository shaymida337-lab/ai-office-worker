import { Quote } from "lucide-react";
import { LANDING_SOCIAL_PROOF } from "./landingContent";
import { colors, radius, type as typography } from "@/lib/design-tokens";

/**
 * אזור הוכחה חברתית — במכוון ללא המלצות: אין עדיין לקוחות מוכחים,
 * ואנחנו לא ממציאים. המבנה מוכן לקבל סיפורי לקוח אמיתיים בעתיד.
 */
export function LandingSocialProofSection() {
  return (
    <section className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="סיפורי לקוחות">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center">
          <p className="page-kicker">{LANDING_SOCIAL_PROOF.kicker}</p>
          <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
            {LANDING_SOCIAL_PROOF.title}
          </h2>
          <p className="mx-auto max-w-2xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
            {LANDING_SOCIAL_PROOF.lead}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {LANDING_SOCIAL_PROOF.slots.map((slot) => (
            <div
              key={slot}
              className={`${radius.card} flex min-h-36 flex-col items-center justify-center gap-3 border-2 border-dashed p-6 text-center`}
              style={{ borderColor: colors.border, backgroundColor: colors.accentMuted }}
            >
              <Quote className="h-6 w-6" style={{ color: colors.textMuted }} aria-hidden />
              <p className="text-sm font-bold" style={{ color: colors.textMuted }}>
                {slot}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center">
          <a
            href={LANDING_SOCIAL_PROOF.ctaHref}
            className="text-sm font-bold underline-offset-4 hover:underline"
            style={{ color: colors.accent }}
          >
            {LANDING_SOCIAL_PROOF.cta}
          </a>
        </p>
      </div>
    </section>
  );
}
