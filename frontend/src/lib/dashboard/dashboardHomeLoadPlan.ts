/**
 * M1 load plan for /dashboard only.
 * First Paint gates pageLoading; Background must not block it.
 * Keep in sync with useDashboardHome.load().
 */

export const DASHBOARD_HOME_FIRST_PAINT_KEYS = [
  "home-metrics",
  "gmail-status",
  "organization-settings",
  "tasks",
] as const;

export type DashboardHomeFirstPaintKey = (typeof DASHBOARD_HOME_FIRST_PAINT_KEYS)[number];

export const DASHBOARD_HOME_BACKGROUND_KEYS = [
  "stats",
  "document-reviews-needs-review",
  "briefing",
  "summary-daily",
  "clients",
  "scan-status",
  "payments",
  "invoices-incomplete",
  "invoices-complete",
  "alerts",
  "system-health",
  "accountant-summary",
  "whatsapp-assistant-stats",
] as const;

export type DashboardHomeBackgroundKey = (typeof DASHBOARD_HOME_BACKGROUND_KEYS)[number];

/** Endpoints that must never gate First Paint (heavy / full lists). */
export const DASHBOARD_HOME_FIRST_PAINT_FORBIDDEN_KEYS = [
  "stats",
  "document-reviews-needs-review",
  "briefing",
  "summary-daily",
  "clients",
  "scan-status",
  "payments",
  "invoices-incomplete",
  "invoices-complete",
  "alerts",
  "system-health",
  "accountant-summary",
] as const;

export function assertDashboardHomeFirstPaintBudget(keys: readonly string[] = DASHBOARD_HOME_FIRST_PAINT_KEYS) {
  if (keys.length > 4) {
    throw new Error(`Dashboard First Paint allows at most 4 requests, got ${keys.length}`);
  }
  for (const key of keys) {
    if ((DASHBOARD_HOME_FIRST_PAINT_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Dashboard First Paint must not include heavy key: ${key}`);
    }
  }
}

/**
 * Runs First Paint to completion, notifies ready, then runs Background.
 * Background failures are swallowed by onBackgroundError and must not reject.
 */
export async function runDashboardHomeLoadPhases(options: {
  loadFirstPaint: () => Promise<void>;
  loadBackground: () => Promise<void>;
  onFirstPaintReady: () => void;
  onBackgroundError?: (error: unknown) => void;
  isCurrent?: () => boolean;
}): Promise<void> {
  assertDashboardHomeFirstPaintBudget();
  await options.loadFirstPaint();
  if (options.isCurrent && !options.isCurrent()) return;
  options.onFirstPaintReady();
  if (options.isCurrent && !options.isCurrent()) return;
  try {
    await options.loadBackground();
  } catch (error) {
    options.onBackgroundError?.(error);
  }
}
