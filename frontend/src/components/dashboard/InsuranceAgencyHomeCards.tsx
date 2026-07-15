"use client";

import type { InsuranceHomeResolvedCard } from "@/lib/dashboard/buildInsuranceHomeOverlay";

export function InsuranceAgencyHomeCards({
  cards,
  onNavigate,
}: {
  cards: InsuranceHomeResolvedCard[];
  onNavigate: (href: string) => void;
}) {
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="insurance-home-cards">
      {cards.map((card) => {
        const content = (
          <>
            <p className="text-xs font-semibold text-[#64748b] dark:text-[#94A3B8]">{card.label}</p>
            <p
              className={`mt-2 font-black text-[#0f172a] dark:text-[#F1F5F9] ${
                card.valueKind === "placeholder" ? "text-sm leading-snug" : "text-xl"
              }`}
            >
              {card.displayValue}
            </p>
          </>
        );

        if (card.clickable && card.href) {
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`insurance-home-card-${card.id}`}
              onClick={() => onNavigate(card.href!)}
              className="rounded-2xl border border-[#dbe5f4] bg-white p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8] dark:border-[#1F2A44] dark:bg-[#111827]"
            >
              {content}
            </button>
          );
        }

        return (
          <article
            key={card.id}
            data-testid={`insurance-home-card-${card.id}`}
            className="rounded-2xl border border-[#dbe5f4] bg-white p-4 shadow-sm dark:border-[#1F2A44] dark:bg-[#111827]"
          >
            {content}
          </article>
        );
      })}
    </section>
  );
}
