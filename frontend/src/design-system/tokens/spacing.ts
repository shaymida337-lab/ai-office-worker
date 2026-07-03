/** Natalie Design System — spacing scale (4px base). No arbitrary spacing. */

export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export type SpaceToken = keyof typeof space;

/** Tailwind gap/padding recipes derived from scale. */
export const spacing = {
  /** Page shell padding */
  page: "p-4 md:p-6 lg:p-8",
  /** Standard card padding */
  card: "p-6 md:p-7",
  /** Vertical rhythm between sections */
  section: "gap-8",
  /** Inline element gaps */
  inline: "gap-4",
  /** Tight clusters */
  tight: "gap-2",
  /** Section header bottom margin */
  sectionHeader: "mb-2",
} as const;

/** Minimum touch target (accessibility). */
export const touchTargetMinPx = 44;
