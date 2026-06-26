"use client";

import { useState } from "react";
import { LANDING_FAQ } from "./landingContent";
import { colors, radius } from "@/lib/design-tokens";
import { ChevronDown } from "lucide-react";

export function LandingFaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="overflow-x-hidden px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <p className="page-kicker">שאלות נפוצות</p>
          <h2 className="text-2xl font-bold md:text-3xl" style={{ color: colors.textPrimary }}>
            לפני שמצטרפים
          </h2>
        </div>

        <div className="grid gap-3">
          {LANDING_FAQ.map((item, index) => {
            const open = openIndex === index;
            return (
              <div
                key={item.question}
                className={`${radius.lg} border overflow-hidden`}
                style={{ borderColor: colors.borderSubtle, backgroundColor: colors.surface }}
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-4 text-right text-base font-bold sm:px-5"
                  style={{ color: colors.textPrimary }}
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? null : index)}
                >
                  <span className="min-w-0">{item.question}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    style={{ color: colors.textMuted }}
                    aria-hidden
                  />
                </button>
                {open ? (
                  <div className="border-t px-4 pb-4 pt-1 text-sm font-medium leading-7 sm:px-5" style={{ borderColor: colors.borderSubtle, color: colors.textSecondary }}>
                    {item.answer}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
