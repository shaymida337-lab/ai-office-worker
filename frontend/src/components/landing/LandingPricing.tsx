"use client";

import { useEffect, useRef } from "react";
import { Check, Star } from "lucide-react";
import { pushToDataLayer } from "@/lib/analytics/data-layer";
import { utmEventParams } from "@/lib/analytics/utm";
import { LANDING_PRICING } from "./landingContent";
import { colors, radius, shadow, type as typography } from "@/lib/design-tokens";

export const PLAN_INTEREST_STORAGE_KEY = "natalie-plan-interest";

export function LandingPricingSection() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const viewedRef = useRef(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!viewedRef.current && entries.some((entry) => entry.isIntersecting)) {
          viewedRef.current = true;
          pushToDataLayer({ event: "pricing_view", ...utmEventParams() });
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  function onPlanCta(planId: string) {
    try {
      sessionStorage.setItem(PLAN_INTEREST_STORAGE_KEY, planId);
    } catch {
      /* storage חסום */
    }
    pushToDataLayer({ event: "pricing_plan_select", plan: planId, ...utmEventParams() });
    pushToDataLayer({ event: "trial_cta_click", location: "pricing", plan: planId, ...utmEventParams() });
  }

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16"
      aria-label="מחירים"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 text-center sm:mb-8">
          <p className="page-kicker">{LANDING_PRICING.kicker}</p>
          <h2 className={`${typography.h2} mb-4`} style={{ color: colors.textPrimary }}>
            {LANDING_PRICING.title}
          </h2>
          <ul
            className="mx-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-bold"
            style={{ color: colors.textSecondary }}
          >
            {LANDING_PRICING.trialStrip.map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="h-4 w-4" style={{ color: colors.successText }} aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-5 md:grid-cols-2 md:items-stretch">
          {LANDING_PRICING.plans.map((plan) => (
            <article
              key={plan.id}
              className={`${radius.card} landing-lift relative flex min-w-0 flex-col border p-6 sm:p-7 ${
                plan.popular ? shadow.raised : shadow.soft
              }`}
              style={{
                backgroundColor: colors.surface,
                borderColor: plan.popular ? colors.accent : colors.borderSubtle,
                borderWidth: plan.popular ? 2 : 1,
              }}
            >
              {plan.popular ? (
                <span
                  className={`${radius.pill} absolute -top-3.5 right-6 inline-flex items-center gap-1 px-3 py-1 text-xs font-extrabold text-white`}
                  style={{ backgroundColor: colors.accent }}
                >
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  הפופולרית ביותר
                </span>
              ) : null}

              <h3 className="text-xl font-extrabold" style={{ color: colors.textPrimary }}>
                {plan.name}
              </h3>
              <p className="mt-1 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
                {plan.positioning}
              </p>

              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold tabular-nums" style={{ color: colors.textPrimary }}>
                  {plan.price} ₪
                </span>
                <span className="text-sm font-semibold" style={{ color: colors.textMuted }}>
                  לחודש
                </span>
              </p>

              <ul className="mt-5 grid flex-1 gap-2.5">
                {plan.includes.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm font-medium leading-6" style={{ color: colors.textSecondary }}>
                    <Check className="mt-1 h-4 w-4 shrink-0" style={{ color: colors.successText }} aria-hidden />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>

              <a
                href={LANDING_PRICING.ctaHref}
                onClick={() => onPlanCta(plan.id)}
                className={`mt-6 w-full text-center ${plan.popular ? "btn" : "btn btn-secondary"}`}
              >
                {LANDING_PRICING.cta}
              </a>
            </article>
          ))}
        </div>

        <p className="mt-6 text-center text-sm font-semibold" style={{ color: colors.textSecondary }}>
          {LANDING_PRICING.comparisonNote}
        </p>
      </div>
    </section>
  );
}
