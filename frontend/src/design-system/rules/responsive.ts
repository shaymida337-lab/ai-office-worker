/** Responsive breakpoints — mobile-first. */

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

export const responsiveRules = {
  mobileFirst: true,
  /** No horizontal scroll on any page shell */
  noHorizontalScroll: "max-w-full overflow-x-clip",
  /** Standard page content width */
  contentNarrow: "mx-auto max-w-3xl",
  contentDefault: "mx-auto max-w-5xl",
  contentWide: "mx-auto max-w-7xl",
  /** KPI / metric grids */
  kpiGrid: "grid grid-cols-2 gap-3 md:grid-cols-4",
  /** Sidebar offset on desktop (RTL) */
  sidebarOffset: "lg:mr-60",
  /** Bottom nav safe area */
  mobileBottomSafe: "pb-24 md:pb-8",
  /** Touch-friendly full-width CTAs on mobile */
  mobileCta: "w-full sm:w-auto",
  definitions: {
    mobile: `< ${breakpoints.md}px`,
    tablet: `${breakpoints.md}px – ${breakpoints.lg - 1}px`,
    desktop: `${breakpoints.lg}px – ${breakpoints.xl - 1}px`,
    wideDesktop: `≥ ${breakpoints.xl}px`,
  },
} as const;
