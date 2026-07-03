import { legacyColorMap } from "../tokens/colors";
import { radius } from "../tokens/radius";
import { typography } from "../tokens/typography";

const c = legacyColorMap;

export const tablePatterns = {
  wrapper: "w-full overflow-x-auto",
  table: "w-full min-w-[640px] border-collapse text-right",
  head: `${typography.caption} font-bold uppercase tracking-wide`,
  headCell: "border-b px-4 py-3",
  headStyle: { borderColor: c.borderSubtle, color: c.textMuted },
  row: "border-b transition-colors hover:bg-[var(--natalie-bg-soft)]",
  rowStyle: { borderColor: c.borderSubtle },
  cell: `${typography.body} px-4 py-4 align-middle`,
  /** Mobile card fallback for each row */
  mobileCard: `${radius.md} border p-4 mb-3`,
  mobileCardStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
} as const;

export const tableResponsiveRules = {
  desktop: "hidden md:table",
  mobileCards: "grid gap-3 md:hidden",
} as const;
