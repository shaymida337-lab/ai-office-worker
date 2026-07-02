"use client";

import { AlertTriangle, CheckCircle2, CheckSquare, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { colors, radius, button, shadow, dashboardHome } from "@/lib/design-tokens";
import { buildAttentionCenterHeading } from "@/lib/dashboard/attentionCenterHeading";

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
  loading = false,
}: {
  cards: AttentionCardData[];
  totalCount?: number;
  loading?: boolean;
}) {
  const activeCards = cards.filter((card) => card.count > 0);
  const urgentCount = activeCards.length;
  const heading = buildAttentionCenterHeading(urgentCount);

  return (
    <section id="natalie-decisions" className="flex h-auto min-w-0 flex-col overflow-visible" aria-label="מרכז תשומת לב">
      <h2 className={dashboardHome.sectionTitle} style={{ color: colors.textPrimary }}>
        {heading.title}
      </h2>
      {heading.subtitle ? (
        <p className={`mt-1 ${dashboardHome.sectionSubtitle}`} style={{ color: colors.textSecondary }}>
          {heading.subtitle}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-3 grid gap-3">
          {Array.from({ length: Math.min(activeCards.length || 1, 3) }).map((_, i) => (
            <div key={i} className="min-h-[120px] animate-pulse rounded-xl border" style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }} />
          ))}
        </div>
      ) : urgentCount === 0 ? (
        <div
          className={`${radius.card} ${shadow.soft} mt-3 flex items-center gap-3 border p-4`}
          style={{ backgroundColor: colors.successBg, borderColor: colors.successBorder }}
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: colors.successText }} strokeWidth={2.4} />
          <p className={dashboardHome.conversation} style={{ color: colors.successText }}>
            נטלי עוקבת אחרי העסק — אין כרגע דברים דחופים לטיפול.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          {activeCards.map((card) => {
            const style = urgencyStyles[card.urgency];
            const Icon = cardIcons[card.id] ?? FileText;

            return (
              <article
                key={card.id}
                className={`${radius.card} ${shadow.soft} flex flex-col border p-4`}
                style={{
                  backgroundColor: style.bg,
                  borderColor: style.border,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                    style={{ backgroundColor: colors.surface, color: style.badge }}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                  </div>
                  <span
                    className={`${radius.pill} px-2 py-0.5 text-xs font-bold tabular-nums`}
                    style={{ backgroundColor: colors.surface, color: style.badge }}
                  >
                    {card.count}
                  </span>
                </div>

                <h3 className={`${dashboardHome.actionLabel} mt-3`} style={{ color: colors.textPrimary }}>
                  {card.label}
                </h3>
                <p className={`mt-1.5 ${dashboardHome.conversation}`} style={{ color: colors.textSecondary }}>
                  {card.description}
                </p>

                <button
                  type="button"
                  onClick={card.onAction}
                  className={`${radius.control} ${button.primary} ${dashboardHome.heroButton} mt-4 min-h-[44px] w-full`}
                  style={{
                    backgroundColor: colors.accent,
                    border: `1px solid ${colors.accent}`,
                    color: colors.surface,
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
