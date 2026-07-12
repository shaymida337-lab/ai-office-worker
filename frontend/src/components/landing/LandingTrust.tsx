import Link from "next/link";
import { Eye, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { LANDING_TRUST } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

const TRUST_ICONS = [ShieldCheck, Lock, Eye, UserCheck] as const;

export function LandingTrustSection() {
  return (
    <section id="trust" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16" aria-label="אמון ואבטחה">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center sm:mb-10">
          <p className="page-kicker">{LANDING_TRUST.kicker}</p>
          <h2 className={`${typography.h2} mb-3`} style={{ color: colors.textPrimary }}>
            {LANDING_TRUST.title}
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_TRUST.cards.map((card, index) => {
            const Icon = TRUST_ICONS[index % TRUST_ICONS.length] ?? ShieldCheck;
            return (
              <article
                key={card.title}
                className={`card landing-lift mb-0 min-w-0 ${shadow.soft}`}
                style={{ borderColor: colors.borderSubtle }}
              >
                <div
                  className={`mb-4 inline-flex h-11 w-11 items-center justify-center ${radius.control}`}
                  style={{ backgroundColor: colors.successBg, color: colors.successText }}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="text-base font-bold leading-snug" style={{ color: colors.textPrimary }}>
                  {card.title}
                </h3>
                <p className="mt-2 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
                  {card.description}
                </p>
              </article>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm font-semibold" style={{ color: colors.textSecondary }}>
          {LANDING_TRUST.links.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? <span aria-hidden> · </span> : null}
              <Link href={link.href} className="underline-offset-4 hover:underline" style={{ color: colors.accent }}>
                {link.label}
              </Link>
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}
