import type { ReactNode } from "react";
import { colors, radius, type } from "@/lib/design-tokens";

type StatusPillTone = "success" | "warn" | "danger" | "info" | "neutral";

const toneStyles: Record<StatusPillTone, { color: string; backgroundColor: string; borderColor: string }> = {
  success: { color: colors.successText, backgroundColor: colors.successBg, borderColor: colors.successBorder },
  warn: { color: colors.warnText, backgroundColor: colors.warnBg, borderColor: colors.warnBorder },
  danger: { color: colors.dangerText, backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  info: { color: colors.infoText, backgroundColor: colors.infoBg, borderColor: colors.infoBorder },
  neutral: { color: colors.textSecondary, backgroundColor: colors.bgSoft, borderColor: colors.border },
};

export function StatusPill({ tone, children }: { tone: StatusPillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-w-11 items-center justify-center whitespace-nowrap border px-3 py-1 font-semibold ${radius.pill} ${type.meta}`}
      style={toneStyles[tone]}
    >
      {children}
    </span>
  );
}
