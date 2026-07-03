import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { typography } from "../tokens/typography";

const c = legacyColorMap;

export const badgePatterns = {
  base: `inline-flex min-h-8 min-w-[44px] items-center justify-center whitespace-nowrap border px-3.5 py-1.5 font-bold ${radius.pill} ${typography.caption}`,
  success: { color: c.successText, backgroundColor: c.successBg, borderColor: c.successBorder },
  warning: { color: c.warnText, backgroundColor: c.warnBg, borderColor: c.warnBorder },
  danger: { color: c.dangerText, backgroundColor: c.dangerBg, borderColor: c.dangerBorder },
  info: { color: c.infoText, backgroundColor: c.infoBg, borderColor: c.infoBorder },
  neutral: { color: c.textSecondary, backgroundColor: c.bgSoft, borderColor: c.border },
} as const;

export type BadgeTone = keyof Omit<typeof badgePatterns, "base">;
