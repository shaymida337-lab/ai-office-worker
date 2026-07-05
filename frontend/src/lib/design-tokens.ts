// MOBILE RULES: mobile-first; touch targets ≥56px buttons; no horizontal scroll; KPI grids are grid-cols-2 md:grid-cols-4.
import { legacyColorMap } from "@/design-system/tokens/colors";

/**
 * מקור האמת לצבעים: design-system/tokens/colors (איחוד שכבות הטוקנים, שלב 1
 * של מבצע ייצוב המסכים). הקובץ הזה נשאר ה-API שכל המסכים צורכים —
 * אותם שמות שדות בדיוק — אבל הערכים מגיעים מהמערכת הסמנטית.
 */
export const colors = legacyColorMap;

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
  page: "p-5 md:p-8",
  card: "p-5 md:p-7",
  section: "gap-6 md:gap-8",
  inline: "gap-4 md:gap-5",
  sectionHeader: "mb-3",
} as const;

/** Mobile-first readability scale — minimum 18px; nothing smaller in product UI. */
export const type = {
  /** Hero greeting — "היי, שי" */
  heroGreeting: "text-4xl font-bold leading-[1.15] tracking-tight",
  h1: "text-3xl font-bold leading-[1.15] tracking-tight md:text-4xl",
  h2: "text-2xl font-bold leading-[1.2] md:text-3xl",
  sectionTitle: "text-2xl font-bold leading-[1.2] md:text-3xl",
  sectionHeader: "text-2xl font-bold leading-[1.2] md:text-3xl",
  cardTitle: "text-xl font-bold leading-[1.25]",
  body: "text-base font-medium leading-[1.6]",
  bodyLg: "text-lg font-medium leading-[1.62]",
  chat: "text-base font-medium leading-[1.6] md:text-lg md:leading-[1.62]",
  caption: "text-xs font-medium leading-[1.55]",
  label: "text-xs font-medium leading-[1.55]",
  meta: "text-xs font-medium leading-[1.55]",
  status: "text-sm font-semibold leading-snug md:text-base",
  kpiValue: "text-3xl font-extrabold leading-none tabular-nums md:text-4xl",
  kpiLabel: "text-base font-semibold leading-[1.5]",
  kpiDescription: "text-xs font-medium leading-[1.55]",
  subtitle: "text-lg font-medium leading-[1.62]",
  badge: "text-xs font-bold leading-[1.4]",
} as const;

export const button = {
  primary:
    "min-h-[56px] px-6 py-3.5 text-sm font-semibold transition-all duration-200 hover:brightness-[0.97] active:scale-[0.99] disabled:opacity-60",
  secondary:
    "min-h-[56px] px-5 py-3.5 text-sm font-semibold transition-all duration-200 hover:bg-[#F0F4FF] active:scale-[0.99] disabled:opacity-60",
} as const;

/** Home dashboard (/dashboard) mobile typography lock — explicit px sizes. */
export const dashboardHome = {
  /** Top app bar — "נטלי" (Nav, dashboard only) */
  topHeaderTitle: "text-[23px] font-bold leading-[1.45]",
  topHeaderSubtitle: "text-[15px] font-medium leading-[1.5]",
  /** Page section label — "העסק שלי" */
  pageSectionLabel: "text-[25px] font-bold leading-[1.45]",
  /** Hero card */
  heroGreeting: "text-[36px] font-bold leading-[1.15] tracking-tight",
  heroBody: "text-[23px] font-medium leading-[1.55]",
  heroStatus: "text-[20px] font-semibold leading-[1.5]",
  heroButton: "text-[21px] font-bold leading-[1.5]",
  /** Main content sections */
  mainSectionTitle: "text-[36px] font-extrabold leading-[1.2] tracking-tight",
  sectionTitle: "text-[25px] font-bold leading-[1.45]",
  sectionSubtitle: "text-[21px] font-medium leading-[1.55]",
  actionLabel: "text-[21px] font-bold leading-[1.5]",
  prompt: "text-[21px] font-semibold leading-[1.55]",
  conversation: "text-[21px] font-medium leading-[1.55]",
  listItem: "text-[21px] font-semibold leading-[1.55]",
  /** Bottom nav labels (dashboard mobile) */
  navLabel: "text-[15px] font-semibold leading-[1.45]",
} as const;

export type KpiAccent = "blue" | "green" | "amber" | "violet";

export const kpiAccentStyles: Record<KpiAccent, { iconBg: string; iconColor: string }> = {
  blue: { iconBg: colors.accentSoft, iconColor: colors.accent },
  green: { iconBg: colors.successBg, iconColor: colors.successText },
  amber: { iconBg: colors.warnBg, iconColor: colors.warnText },
  violet: { iconBg: "#F3E8FF", iconColor: "#6D28D9" },
};
