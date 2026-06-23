// MOBILE RULES: mobile-first; touch targets ≥44px; no horizontal scroll; KPI grids are grid-cols-2 md:grid-cols-4.
export const colors = {
  bg: "#F4F6FB",
  bgSoft: "#EEF2FA",
  surface: "#FFFFFF",
  border: "#E6EAF2",
  borderSubtle: "#EDF1F7",
  textPrimary: "#0E1116",
  textSecondary: "#6B7686",
  textMuted: "#8A94A6",
  accent: "#1D5BFF",
  accentHover: "#1746C7",
  accentSoft: "#E8EEFF",
  accentMuted: "#F0F4FF",
  successText: "#047857",
  successBg: "#ECFDF5",
  successBorder: "#A7F3D0",
  warnText: "#B45309",
  warnBg: "#FFFBEB",
  warnBorder: "#FDE68A",
  dangerText: "#B91C1C",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FECACA",
  infoText: "#1D4ED8",
  infoBg: "#EFF6FF",
  infoBorder: "#BFDBFE",
} as const;

export const radius = {
  card: "rounded-2xl",
  control: "rounded-xl",
  pill: "rounded-full",
} as const;

export const shadow = {
  card: "shadow-[0_8px_30px_rgba(20,40,90,0.06)]",
  raised: "shadow-[0_16px_48px_rgba(20,40,90,0.10)]",
  soft: "shadow-[0_4px_18px_rgba(20,40,90,0.05)]",
} as const;

export const spacing = {
  page: "p-6 md:p-8",
  card: "p-5 md:p-6",
  section: "gap-6",
  inline: "gap-3",
} as const;

export const type = {
  pageTitle: "text-2xl font-extrabold tracking-tight md:text-3xl",
  sectionTitle: "text-lg font-bold",
  body: "text-sm",
  meta: "text-xs",
  kpi: "text-2xl font-extrabold md:text-3xl",
} as const;

export type KpiAccent = "blue" | "green" | "amber" | "violet";

export const kpiAccentStyles: Record<KpiAccent, { iconBg: string; iconColor: string }> = {
  blue: { iconBg: colors.accentSoft, iconColor: colors.accent },
  green: { iconBg: colors.successBg, iconColor: colors.successText },
  amber: { iconBg: colors.warnBg, iconColor: colors.warnText },
  violet: { iconBg: "#F3E8FF", iconColor: "#7C3AED" },
};
