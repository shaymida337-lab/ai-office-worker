/** Natalie Design System — elevation levels. */

export const elevation = {
  none: "shadow-none",
  low: "shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.04)]",
  medium: "shadow-[0_6px_24px_rgba(15,23,42,0.06)]",
  high: "shadow-[0_10px_40px_rgba(15,23,42,0.08)]",
  overlay: "shadow-[0_20px_56px_rgba(15,23,42,0.12)]",
} as const;

/** Legacy shadow aliases. */
export const legacyShadow = {
  card: elevation.high,
  raised: elevation.overlay,
  soft: elevation.medium,
} as const;

export type ElevationToken = keyof typeof elevation;
