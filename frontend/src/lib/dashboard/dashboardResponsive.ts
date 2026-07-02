/** Home dashboard responsive breakpoints validated in Phase 7. */
export const DASHBOARD_RESPONSIVE_BREAKPOINTS = [390, 430, 768, 1024, 1366, 1600, 1920] as const;

/** Activity timeline stays hidden below Tailwind `md` (768px) by design since Phase 6. */
export const DASHBOARD_ACTIVITY_MOBILE_POLICY =
  "DashboardActivityTimeline is hidden below md (768px). Quick Actions and Today remain primary on mobile.";

export const DASHBOARD_KPI_GRID_CLASSES = "grid-cols-2 lg:grid-cols-4";

export const DASHBOARD_QUICK_ACTION_GRID_CLASSES = "grid-cols-2 min-[430px]:grid-cols-3";

export const DASHBOARD_MIN_TOUCH_TARGET_CLASS = "min-h-11";
