"use client";

import { AlertTriangle, CheckSquare, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { colors, radius, button, shadow, dashboardHome } from "@/lib/design-tokens";

export type AttentionCardData = {
  id: string;
  label: string;
  description: string;
  count: number;
  urgency: "urgent" | "warn" | "info";
  actionLabel: string;
  onAction: () => void;
};

const urgencyStyles = {
  urgent: {
    border: colors.dangerBorder,
    bg: colors.dangerBg,
    badge: colors.dangerText,
  },
  warn: {
    border: colors.warnBorder,
    bg: colors.warnBg,
    badge: colors.warnText,
  },
  info: {
    border: colors.infoBorder,
    bg: colors.infoBg,
    badge: colors.infoText,
  },
};

const cardIcons: Record<string, LucideIcon> = {
  invoices: FileText,
  payments: AlertTriangle,
  tasks: CheckSquare,
};

export function NatalieAttentionCenter({
  cards,
  totalCount,
  loading = false,
}: {
  cards: AttentionCardData[];
  totalCount: number;
  loading?: boolean;
}) {
  const activeCount = cards.filter((c) => c.count > 0).length;
  const titleCount = activeCount > 0 ? activeCount : totalCount > 0 ? totalCount : 3;

  return (
    <section id="natalie-decisions" className="flex h-auto min-w-0 flex-col overflow-visible" aria-label="מרכז תשומת לב">
      <h2 className={dashboardHome.sectionTitle} style={{ color: colors.textPrimary }}>
        {activeCount > 0 || totalCount > 0
          ? `ממליצה לטפל ב־${titleCount} ${titleCount === 1 ? "דבר" : "דברים"}`
          : "ממליצה לטפל ב־3 דברים"}
      </h2>
      <p className={`mt-1 ${dashboardHome.sectionSubtitle}`} style={{ color: colors.textSecondary }}>
        אלה הדברים שכדאי לסגור קודם
      </p>

      {loading ? (
        <div className="mt-3 grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="min-h-[148px] animate-pulse rounded-xl border" style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }} />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          {cards.map((card) => {
            const style = urgencyStyles[card.urgency];
            const Icon = cardIcons[card.id] ?? FileText;
            const hasItems = card.count > 0;

            return (
              <article
                key={card.id}
                className={`${radius.card} ${shadow.soft} flex min-h-[148px] flex-col border p-4`}
                style={{
                  backgroundColor: hasItems ? style.bg : colors.surface,
                  borderColor: hasItems ? style.border : colors.borderSubtle,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                    style={{ backgroundColor: hasItems ? colors.surface : colors.bgSoft, color: style.badge }}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                  </div>
                  {hasItems && (
                    <span
                      className={`${radius.pill} px-2 py-0.5 text-xs font-bold tabular-nums`}
                      style={{ backgroundColor: colors.surface, color: style.badge }}
                    >
                      {card.count}
                    </span>
                  )}
                </div>

                <h3 className={`${dashboardHome.actionLabel} mt-3`} style={{ color: colors.textPrimary }}>
                  {card.label}
                </h3>
                <p className={`mt-1.5 flex-1 ${dashboardHome.conversation}`} style={{ color: colors.textSecondary }}>
                  {card.description}
                </p>

                <button
                  type="button"
                  onClick={card.onAction}
                  className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} mt-4 min-h-[44px] w-full`}
                  style={{
                    backgroundColor: hasItems ? colors.accent : colors.bgSoft,
                    border: `1px solid ${hasItems ? colors.accent : colors.borderSubtle}`,
                    color: hasItems ? colors.surface : colors.textSecondary,
                  }}
                >
                  {card.actionLabel}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
