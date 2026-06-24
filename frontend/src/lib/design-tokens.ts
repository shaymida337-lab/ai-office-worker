// MOBILE RULES: mobile-first; touch targets ≥44px; no horizontal scroll; KPI grids are grid-cols-2 md:grid-cols-4.
export const colors = {
  bg: "#F4F6FB",
  bgSoft: "#EEF2FA",
  surface: "#FFFFFF",
  border: "#DDE3EE",
  borderSubtle: "#E8EDF5",
  textPrimary: "#0A0D12",
  textSecondary: "#4B5563",
  textMuted: "#5C6678",
  accent: "#1D5BFF",
  accentHover: "#1746C7",
  accentSoft: "#E8EEFF",
  accentMuted: "#F0F4FF",
  successText: "#065F46",
  successBg: "#ECFDF5",
  successBorder: "#6EE7B7",
  warnText: "#92400E",
  warnBg: "#FFFBEB",
  warnBorder: "#FCD34D",
  dangerText: "#991B1B",
  dangerBg: "#FEF2F2",
  dangerBorder: "#FCA5A5",
  infoText: "#1E40AF",
  infoBg: "#EFF6FF",
  infoBorder: "#93C5FD",
} as const;

export const radius = {
  card: "rounded-2xl",
  lg: "rounded-2xl",
  control: "rounded-xl",
  pill: "rounded-full",
} as const;

export const shadow = {
  card: "shadow-[0_10px_40px_rgba(15,23,42,0.08)]",
  raised: "shadow-[0_20px_56px_rgba(15,23,42,0.12)]",
  soft: "shadow-[0_6px_24px_rgba(15,23,42,0.06)]",
} as const;

export const spacing = {
  page: "p-6 md:p-8",
  card: "p-6 md:p-7",
  section: "gap-8",
  inline: "gap-4",
  sectionHeader: "mb-2",
} as const;

/** Strict typography scale — Sprint 14 */
export const type = {
  h1: "text-[32px] font-extrabold leading-[1.15] tracking-tight md:text-[40px]",
  h2: "text-[24px] font-bold leading-tight md:text-[28px]",
  sectionTitle: "text-[22px] font-bold leading-snug",
  sectionHeader: "text-[24px] font-bold leading-snug",
  cardTitle: "text-[18px] font-semibold leading-snug",
  body: "text-base font-medium leading-7",
  caption: "text-sm font-medium leading-6",
  label: "text-xs font-medium leading-5",
  meta: "text-xs font-medium leading-5",
  kpiValue: "text-[32px] font-extrabold leading-none tabular-nums md:text-[40px]",
  kpiLabel: "text-[17px] font-semibold leading-6",
  kpiDescription: "text-sm font-medium leading-6",
  subtitle: "text-lg font-medium leading-8",
  badge: "text-sm font-bold leading-5",
} as const;

export const button = {
  primary: "min-h-[52px] px-6 py-3 text-base font-bold transition-all duration-200 hover:brightness-[0.97] active:scale-[0.99] disabled:opacity-60",
  secondary: "min-h-[52px] px-5 py-3 text-base font-bold transition-all duration-200 hover:bg-[#F0F4FF] active:scale-[0.99] disabled:opacity-60",
} as const;

export type KpiAccent = "blue" | "green" | "amber" | "violet";

export const kpiAccentStyles: Record<KpiAccent, { iconBg: string; iconColor: string }> = {
  blue: { iconBg: colors.accentSoft, iconColor: colors.accent },
  green: { iconBg: colors.successBg, iconColor: colors.successText },
  amber: { iconBg: colors.warnBg, iconColor: colors.warnText },
  violet: { iconBg: "#F3E8FF", iconColor: "#6D28D9" },
};
