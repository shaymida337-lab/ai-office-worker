"use client";

import type { LucideIcon } from "lucide-react";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";
import type { DecisionKind } from "@/lib/dashboard/decisions";

const kindIconTone: Record<DecisionKind, { bg: string; color: string }> = {
  urgent_payment: { bg: colors.dangerBg, color: colors.dangerText },
  payment: { bg: colors.infoBg, color: colors.infoText },
  blocked_review: { bg: colors.warnBg, color: colors.warnText },
  document_review: { bg: colors.warnBg, color: colors.warnText },
  missing_invoice: { bg: "#FFF7ED", color: "#C2410C" },
  appointment: { bg: "#F3E8FF", color: "#6D28D9" },
  alert: { bg: colors.dangerBg, color: colors.dangerText },
};

export function DecisionCard({
  typeLabel,
  title,
  description,
  meta,
  urgent,
  primaryLabel,
  secondaryLabel,
  icon: Icon,
  kind,
  emphasized = false,
  onPrimary,
  onSecondary,
}: {
  typeLabel: string;
  title: string;
  description: string;
  meta?: string;
  urgent?: boolean;
  primaryLabel: string;
  secondaryLabel?: string;
  icon: LucideIcon;
  kind: DecisionKind;
  emphasized?: boolean;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  const tone = kindIconTone[kind];

  return (
    <article
      className={`${radius.lg} border transition duration-200 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300`}
      style={{
        backgroundColor: colors.surface,
        borderColor: emphasized ? colors.accent : urgent ? colors.warnBorder : colors.borderSubtle,
        boxShadow: emphasized
          ? "0 12px 36px rgba(29,91,255,0.12)"
          : "0 6px 24px rgba(15,23,42,0.05)",
      }}
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
            style={{ backgroundColor: tone.bg, color: tone.color }}
          >
            <Icon className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`${radius.pill} px-2.5 py-1 text-xs font-bold`}
                style={{
                  backgroundColor: urgent ? colors.warnBg : colors.bgSoft,
                  color: urgent ? colors.warnText : colors.textMuted,
                }}
              >
                {typeLabel}
              </span>
              {urgent && (
                <span className="text-xs font-bold" style={{ color: colors.dangerText }}>
                  דחוף
                </span>
              )}
            </div>
            <h3
              className={`${typography.cardTitle} mt-2 break-words`}
              style={{ color: colors.textPrimary }}
            >
              {title}
            </h3>
            <p className={`${typography.body} mt-1.5 leading-7`} style={{ color: colors.textSecondary }}>
              {description}
            </p>
            {meta && (
              <p className={`${typography.caption} mt-2 font-semibold tabular-nums`} style={{ color: colors.textMuted }}>
                {meta}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={onPrimary}
            className={`${radius.control} ${button.primary} w-full sm:w-auto`}
            style={{
              backgroundColor: colors.accent,
              border: `1px solid ${colors.accent}`,
              color: colors.surface,
            }}
          >
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className={`${radius.control} ${button.secondary} w-full sm:w-auto`}
              style={{
                backgroundColor: colors.surface,
                border: `1px solid ${colors.border}`,
                color: colors.textSecondary,
              }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
