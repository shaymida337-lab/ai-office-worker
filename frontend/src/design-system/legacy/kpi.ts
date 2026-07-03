import { palette } from "../tokens/colors";

/** KPI accent styles — legacy dashboard metric cards. */
export type KpiAccent = "blue" | "green" | "amber" | "violet";

export const kpiAccentStyles: Record<KpiAccent, { iconBg: string; iconColor: string }> = {
  blue: { iconBg: palette.blue50, iconColor: palette.blue500 },
  green: { iconBg: palette.green50, iconColor: palette.green700 },
  amber: { iconBg: palette.amber50, iconColor: palette.amber700 },
  violet: { iconBg: palette.violet50, iconColor: palette.violet700 },
};
