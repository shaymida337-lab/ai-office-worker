import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { typography } from "../tokens/typography";
import { motion } from "../tokens/motion";

const c = legacyColorMap;

/** Primary product navigation is bottom nav only (no desktop sidebar). */
export const navigationPatterns = {
  bottomNav:
    "fixed inset-x-0 bottom-0 z-40 h-[4.5rem] border-t border-[var(--natalie-border,#D9E2F2)] bg-[var(--natalie-surface,#ffffff)]/98",
  bottomNavStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
  navItem: `group relative flex min-h-11 items-center gap-3 border px-3 py-2.5 text-[15px] font-bold ${radius.md} ${motion.reduced}`,
  navItemActive: {
    borderColor: "#CDD9FF",
    backgroundColor: c.accentSoft,
    color: c.accent,
    boxShadow: `inset -3px 0 0 ${c.accent}`,
  },
  navItemIdle: { borderColor: "transparent", color: c.textPrimary },
  pageTitle: typography.h1,
  sectionTitle: typography.section,
} as const;
