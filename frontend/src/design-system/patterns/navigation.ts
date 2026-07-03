import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { typography } from "../tokens/typography";
import { motion } from "../tokens/motion";

const c = legacyColorMap;

export const navigationPatterns = {
  sidebar: "fixed right-0 top-0 z-50 hidden h-screen w-60 flex-col border-l px-3 py-4 backdrop-blur-xl lg:flex",
  sidebarStyle: {
    borderColor: c.border,
    backgroundColor: "rgba(255,255,255,0.97)",
    boxShadow: "0 12px 40px rgba(20,40,90,0.08)",
  },
  navItem: `group relative flex min-h-11 items-center gap-3 border px-3 py-2.5 text-[15px] font-bold ${radius.md} ${motion.reduced}`,
  navItemActive: {
    borderColor: "#CDD9FF",
    backgroundColor: c.accentSoft,
    color: c.accent,
    boxShadow: `inset -3px 0 0 ${c.accent}`,
  },
  navItemIdle: { borderColor: "transparent", color: c.textPrimary },
  bottomNav: "fixed inset-x-0 bottom-0 z-40 border-t lg:hidden",
  bottomNavStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
  pageTitle: typography.h1,
  sectionTitle: typography.section,
} as const;
