"use client";

import type { LucideIcon } from "lucide-react";
import { colors, radius, button, type as typography } from "@/lib/design-tokens";
import type { DecisionKind } from "@/lib/dashboard/decisions";

export function DecisionCard({
  typeLabel,
  title,
  description,
  meta,
  urgent,
  primaryLabel,
  secondaryLabel,
  icon: _Icon,
  kind,
  emphasized = false,
  briefingMode = false,
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
  briefingMode?: boolean;
  onPrimary: () => void;
  onSecondary?: () => void;
}) {
  return (
    <article
      className={`${radius.control} border`}
      style={{
        backgroundColor: colors.surface,
        borderColor: emphasized ? colors.accent : urgent ? colors.warnBorder : colors.borderSubtle,
      }}
    >
      <div className={`flex flex-col ${briefingMode ? "gap-2.5 p-3 md:gap-3 md:p-4" : "gap-4 p-4 md:p-5"}`}>
        <div className="min-w-0 text-right">
          {briefingMode ? (
            <p className="text-xs font-bold" style={{ color: colors.textMuted }}>
              {typeLabel}
            </p>
          ) : (
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
            </div>
          )}
          <h3
            className={`${briefingMode ? "text-base font-bold" : typography.cardTitle} mt-0.5 break-words`}
            style={{ color: colors.textPrimary }}
          >
            {title}
          </h3>
          <p
            className={`mt-0.5 ${briefingMode ? "text-sm leading-6" : typography.body} leading-7`}
            style={{ color: colors.textSecondary }}
          >
            {description}
          </p>
          {meta && (
            <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: colors.textPrimary }}>
              {meta}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onPrimary}
          className={`${radius.control} ${button.primary} min-h-[44px] w-full md:min-h-[48px] md:w-auto md:min-w-[120px]`}
          style={{
            backgroundColor: colors.accent,
            border: `1px solid ${colors.accent}`,
            color: colors.surface,
          }}
        >
          {primaryLabel}
        </button>
        {!briefingMode && secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className={`${radius.control} ${button.secondary} w-full md:w-auto`}
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
    </article>
  );
}
