import { legacyColorMap } from "../tokens/colors";
import { elevation } from "../tokens/elevation";
import { radius } from "../tokens/radius";
import { spacing } from "../tokens/spacing";

const c = legacyColorMap;

export const cardPatterns = {
  base: `${radius.card} border ${elevation.high} ${spacing.card}`,
  baseStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
  /** Natalie employee voice — minimal, no heavy chrome */
  employee: "py-2 md:py-4",
  /** Priority inbox item */
  decision: `${radius.md} border ${elevation.low}`,
  decisionStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
  /** Quiet metrics / chips row */
  summary: "border-t border-b py-6",
  summaryStyle: { borderColor: c.borderSubtle },
  /** Settings sections */
  settings: `${radius.card} border ${elevation.medium} ${spacing.card}`,
  /** Empty / calm states */
  empty: `${radius.lg} border ${elevation.low} text-center ${spacing.card}`,
  emptyStyle: {
    backgroundColor: c.surface,
    borderColor: c.borderSubtle,
    backgroundImage: "linear-gradient(180deg, rgba(29,91,255,0.03) 0%, rgba(255,255,255,0) 100%)",
  },
  /** Success confirmation */
  success: `${radius.md} border`,
  successStyle: { backgroundColor: c.successBg, borderColor: c.successBorder },
} as const;

export type CardPattern = keyof typeof cardPatterns;
