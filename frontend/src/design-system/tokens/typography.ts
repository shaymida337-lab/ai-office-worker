/** Natalie Design System — strict typography scale. No arbitrary sizes below 18px. */

export const fontFamily = {
  sans: "var(--font-geist-sans, system-ui, -apple-system, 'Segoe UI', sans-serif)",
  mono: "var(--font-geist-mono, ui-monospace, monospace)",
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const;

/** Pixel sizes — source of truth (maps to Tailwind extended scale). */
export const fontSize = {
  heroGreeting: 40,
  h1: 32,
  h2: 30,
  section: 30,
  cardTitle: 26,
  body: 21,
  bodyLg: 22,
  chat: 21,
  button: 20,
  status: 18,
  caption: 18,
} as const;

export const lineHeight = {
  heroGreeting: 1.15,
  heading: 1.2,
  cardTitle: 1.25,
  body: 1.6,
  bodyLg: 1.62,
  caption: 1.55,
} as const;

/** Tailwind class recipes — use these only. */
export const typography = {
  heroGreeting: "text-4xl font-bold leading-[1.15] tracking-tight",
  h1: "text-3xl font-bold leading-[1.15] tracking-tight md:text-4xl",
  h2: "text-2xl font-bold leading-[1.2] md:text-3xl",
  h3: "text-xl font-bold leading-[1.25]",
  section: "text-2xl font-bold leading-[1.2] md:text-3xl",
  bodyLg: "text-lg font-medium leading-[1.62]",
  body: "text-base font-medium leading-[1.6]",
  chat: "text-base font-medium leading-[1.6] md:text-lg md:leading-[1.62]",
  small: "text-sm font-medium leading-[1.55]",
  caption: "text-xs font-medium leading-[1.55]",
} as const;

/** Legacy aliases (Sprint 14 compatibility). */
export const legacyTypography = {
  h1: typography.h1,
  h2: typography.h2,
  sectionTitle: typography.section,
  sectionHeader: typography.section,
  cardTitle: typography.h3,
  body: typography.body,
  caption: typography.caption,
  label: typography.caption,
  meta: typography.caption,
  kpiValue: "text-3xl font-extrabold leading-none tabular-nums md:text-4xl",
  kpiLabel: "text-base font-semibold leading-[1.5]",
  kpiDescription: typography.caption,
  subtitle: typography.bodyLg,
  badge: "text-xs font-bold leading-[1.4]",
} as const;

export type TypographyToken = keyof typeof typography;
