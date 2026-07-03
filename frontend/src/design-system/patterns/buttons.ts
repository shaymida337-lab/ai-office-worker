import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { motion } from "../tokens/motion";

const c = legacyColorMap;

/** Button pattern recipes — use Natalie DS tokens only. */
export const buttonPatterns = {
  base: `inline-flex items-center justify-center gap-2 min-h-[56px] px-6 py-3.5 font-semibold ${radius.control} ${motion.press} ${motion.reduced} disabled:opacity-60 disabled:pointer-events-none`,
  primary: {
    className: "border border-transparent",
    style: { backgroundColor: c.accent, borderColor: c.accent, color: c.surface },
    hover: { filter: "brightness(0.97)" },
    focus: `ring-2 ring-offset-2 ring-[${c.accent}]`,
  },
  secondary: {
    className: "border",
    style: { backgroundColor: c.surface, borderColor: c.border, color: c.textSecondary },
    hover: { backgroundColor: c.accentMuted },
  },
  ghost: {
    className: "border border-transparent bg-transparent",
    style: { color: c.accent },
    hover: { backgroundColor: c.accentSoft },
  },
  danger: {
    className: "border",
    style: { backgroundColor: c.dangerBg, borderColor: c.dangerBorder, color: c.dangerText },
  },
  icon: {
    className: `inline-flex items-center justify-center min-h-[44px] min-w-[44px] ${radius.control}`,
    style: { backgroundColor: c.accentSoft, color: c.accent },
  },
  loading: "opacity-80 pointer-events-none",
} as const;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";

/** Legacy button classes (backward compatible). */
export const legacyButton = {
  primary: `${buttonPatterns.base} transition-all duration-200 hover:brightness-[0.97]`,
  secondary: `${buttonPatterns.base} transition-all duration-200 hover:bg-[#F0F4FF]`,
} as const;
