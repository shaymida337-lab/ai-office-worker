import { LANDING_FEATURES, LANDING_HOW_IT_WORKS, LANDING_INTEGRATIONS } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";
import {
  CalendarDays,
  FileText,
  Mail,
  MessageCircle,
  Sparkles,
  Users,
} from "lucide-react";

const FEATURE_ICONS = [Mail, FileText, MessageCircle, CalendarDays, Users, Sparkles] as const;

export function LandingIntegrationsStrip() {
  return (
    <section className="overflow-x-hidden px-4 py-8 sm:px-6" aria-label="אינטגרציות">
      <div className="mx-auto max-w-6xl text-center">
        <p className="mb-4 text-sm font-semibold" style={{ color: colors.textMuted }}>
          מתחברת לכלים שאתם כבר עובדים איתם
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {LANDING_INTEGRATIONS.map((item) => (
            <span
              key={item}
              className={`${radius.pill} border px-3 py-2 text-sm font-semibold sm:px-4`}
              style={{ borderColor: colors.border, backgroundColor: colors.surface, color: colors.textSecondary }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingFeaturesSection() {
  return (
    <section id="features" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center sm:mb-10">
          <p className="page-kicker">יכולות</p>
          <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
            מה נטלי עושה בשבילכם כל יום
          </h2>
          <p className="mx-auto max-w-2xl text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
            מיילים, מסמכים, יומן, לקוחות ותשלומים — במקום אחד, בשפה שלכם.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_FEATURES.map((feature, index) => {
            const Icon = FEATURE_ICONS[index] ?? Sparkles;
            return (
              <article
                key={feature.title}
                className={`card mb-0 min-w-0 ${shadow.soft}`}
                style={{ borderColor: colors.borderSubtle }}
              >
                <div
                  className={`mb-4 inline-flex h-11 w-11 items-center justify-center ${radius.control}`}
                  style={{ backgroundColor: colors.accentSoft, color: colors.accent }}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="text-lg font-bold leading-snug" style={{ color: colors.textPrimary }}>
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function LandingHowItWorksSection() {
  return (
    <section id="how-it-works" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div
          className={`${radius.card} border ${shadow.soft} grid gap-8 p-5 sm:p-7 lg:grid-cols-2 lg:items-center lg:gap-10`}
          style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
        >
          <div className="min-w-0 text-right">
            <p className="page-kicker">איך זה עובד</p>
            <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
              מתחילים לעבוד איתה בשלושה צעדים
            </h2>
            <p className="text-base font-medium leading-7" style={{ color: colors.textSecondary }}>
              בלי הטמעה, בלי הדרכות ובלי ללמוד מערכת חדשה — נטלי מצטרפת לכלים שכבר יש לכם.
            </p>
          </div>

          <ol className="grid min-w-0 gap-3">
            {LANDING_HOW_IT_WORKS.map((step, index) => (
              <li
                key={step.title}
                className={`flex items-start gap-3 ${radius.control} border px-4 py-3.5`}
                style={{ borderColor: colors.borderSubtle, backgroundColor: colors.accentMuted }}
              >
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: colors.accent }}
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-6" style={{ color: colors.textPrimary }}>
                    {step.title}
                  </span>
                  <span className="block text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
                    {step.description}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
