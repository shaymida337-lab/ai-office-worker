/** Natalie Design System — radius scale (px). */

export const radiusPx = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const radius = {
  sm: "rounded-lg",
  md: "rounded-xl",
  lg: "rounded-2xl",
  xl: "rounded-3xl",
  full: "rounded-full",
  /** Legacy aliases */
  card: "rounded-2xl",
  control: "rounded-xl",
  pill: "rounded-full",
} as const;

export type RadiusToken = keyof typeof radiusPx;
