import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { colors, radius, shadow, type } from "@/lib/design-tokens";

export type PriorityInboxKind = "review" | "missing" | "payment" | "alert";

const kindAccent: Record<PriorityInboxKind, { bg: string; color: string }> = {
  review: { bg: colors.warnBg, color: colors.warnText },
  missing: { bg: "#FFF7ED", color: "#C2410C" },
  payment: { bg: colors.infoBg, color: colors.infoText },
  alert: { bg: colors.dangerBg, color: colors.dangerText },
};

export function PriorityInboxItem({
  kind,
  icon: Icon,
  title,
  reason,
  meta,
  pill,
  primaryAction,
  secondaryAction,
}: {
  kind: PriorityInboxKind;
  icon: LucideIcon;
  title: string;
  reason?: string;
  meta?: string;
  pill?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const accent = kindAccent[kind];

  return (
    <article
      className={`${radius.card} border transition duration-200`}
      style={{ backgroundColor: colors.surface, borderColor: colors.borderSubtle }}
    >
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl"
            style={{ backgroundColor: accent.bg, color: accent.color }}
          >
            <Icon className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`${type.cardTitle} truncate`} style={{ color: colors.textPrimary }}>
                {title}
              </h3>
              {pill}
            </div>
            {reason && (
              <p className={`${type.caption} mt-1.5 line-clamp-2`} style={{ color: colors.textSecondary }}>
                {reason}
              </p>
            )}
            {meta && (
              <p className={`${type.meta} mt-1 font-semibold`} style={{ color: colors.textMuted }}>
                {meta}
              </p>
            )}
          </div>
        </div>
        {(primaryAction || secondaryAction) && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap md:w-auto md:justify-end">
            {primaryAction}
            {secondaryAction}
          </div>
        )}
      </div>
    </article>
  );
}
