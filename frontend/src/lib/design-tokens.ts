// MOBILE RULES: mobile-first; touch targets ≥44px; no horizontal scroll; KPI grids are grid-cols-2 md:grid-cols-4.
export const colors = {
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  textPrimary: "#111827",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  accent: "#2563EB",
  accentHover: "#1D4ED8",
  accentSoft: "#EFF6FF",
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
  card: "shadow-sm",
  raised: "shadow-md",
} as const;

export const spacing = {
  page: "p-6 md:p-8",
  card: "p-5",
  section: "gap-6",
  inline: "gap-3",
} as const;

export const type = {
  pageTitle: "text-2xl font-bold",
  sectionTitle: "text-lg font-semibold",
  body: "text-sm",
  meta: "text-xs",
  kpi: "text-3xl font-bold",
} as const;
