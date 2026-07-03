import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { spacing } from "../tokens/spacing";
import { motion } from "../tokens/motion";

const c = legacyColorMap;

export const listPatterns = {
  stack: `grid ${spacing.tight}`,
  /** Standard read-only row */
  row: `${radius.md} flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5`,
  rowStyle: { backgroundColor: c.bgSoft, border: `1px solid ${c.borderSubtle}` },
  /** Clickable navigation row */
  clickable: `${radius.md} flex min-h-[52px] cursor-pointer items-center gap-4 p-4 ${motion.hoverLift}`,
  clickableStyle: { backgroundColor: c.surface, border: `1px solid ${c.borderSubtle}` },
  /** Expandable details row */
  expandable: "list-none cursor-pointer py-4 font-semibold",
  /** Selection row (checkbox/radio leading) */
  selection: "flex min-h-[52px] items-start gap-3 p-4",
} as const;

export type ListPattern = keyof typeof listPatterns;
