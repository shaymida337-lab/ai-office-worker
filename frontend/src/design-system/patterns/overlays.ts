import { legacyColorMap } from "../tokens/colors";
import { elevation } from "../tokens/elevation";
import { radius } from "../tokens/radius";
import { spacing } from "../tokens/spacing";

const c = legacyColorMap;

export const dialogPatterns = {
  overlay: "fixed inset-0 z-50 grid place-items-center p-4 md:p-8",
  overlayStyle: { backgroundColor: "rgba(10,13,18,0.48)" },
  panel: `${radius.lg} border ${elevation.overlay} w-full max-w-lg ${spacing.card}`,
  panelStyle: { backgroundColor: c.surface, borderColor: c.border },
} as const;

export const sheetPatterns = {
  overlay: "fixed inset-0 z-50",
  overlayStyle: { backgroundColor: "rgba(10,13,18,0.48)" },
  panel: `fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto ${radius.lg} border-t ${spacing.card}`,
  panelStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
  sidePanel: `fixed inset-y-0 right-0 z-50 w-full max-w-md border-l ${spacing.page}`,
  sidePanelStyle: { backgroundColor: c.surface, borderColor: c.borderSubtle },
} as const;

export const toastPatterns = {
  stack: "grid gap-3",
  item: `${radius.md} border px-4 py-3 font-bold leading-7`,
  success: { color: c.successText, backgroundColor: c.successBg, borderColor: c.successBorder },
  warning: { color: c.warnText, backgroundColor: c.warnBg, borderColor: c.warnBorder },
  danger: { color: c.dangerText, backgroundColor: c.dangerBg, borderColor: c.dangerBorder },
  info: { color: c.infoText, backgroundColor: c.infoBg, borderColor: c.infoBorder },
} as const;
