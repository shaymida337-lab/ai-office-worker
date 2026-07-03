import { touchTargetMinPx } from "../tokens/spacing";

/** WCAG-oriented accessibility rules for Natalie DS. */

export const accessibilityRules = {
  /** Minimum touch target (Apple HIG / WCAG 2.5.5) */
  touchTargetMinPx,
  touchTargetClass: "min-h-[44px] min-w-[44px]",
  /** Focus visible on all interactive elements */
  focusRing: "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D5BFF] focus-visible:ring-offset-2",
  /** Contrast — text on surface must meet 4.5:1 for body, 3:1 for large text */
  contrast: {
    bodyMinRatio: 4.5,
    largeTextMinRatio: 3,
    note: "Use semantic textPrimary/textSecondary only — never raw gray hex in components",
  },
  /** Keyboard navigation */
  keyboard: {
    trapInModal: true,
    escapeClosesOverlay: true,
    skipToContentId: "main-content",
  },
  /** Reduced motion */
  reducedMotion: "motion-reduce:transition-none motion-reduce:animate-none",
  /** Screen reader */
  srOnly: "sr-only",
  ariaLivePolite: { "aria-live": "polite" as const },
  ariaLiveAssertive: { "aria-live": "assertive" as const },
} as const;
