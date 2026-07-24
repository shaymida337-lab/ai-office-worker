/**
 * PWA home launch policy.
 *
 * 1) start_url marker (?source=pwa) → clean /dashboard (when Chrome honors start_url).
 * 2) Standalone cold-resume after long hide → /dashboard once (when OS restores the
 *    last window instead of navigating to start_url).
 *
 * Direct deep links, reload, back/forward, and short background returns stay put.
 */

export const APP_HOME_PATH = "/dashboard";
export const PWA_LAUNCH_PARAM = "source";
export const PWA_LAUNCH_VALUE = "pwa";
/** Must stay in sync with public/site.webmanifest start_url. */
export const PWA_START_URL = `${APP_HOME_PATH}?${PWA_LAUNCH_PARAM}=${PWA_LAUNCH_VALUE}`;

/** localStorage: last time standalone went hidden (timestamp ms only — never a route). */
export const PWA_HIDDEN_AT_KEY = "natalie_pwa_hidden_at";

/**
 * Gap after which a standalone resume is treated as a cold reopen (icon / full close),
 * not a short app-switch. Tuned so brief background stays on the current screen.
 */
export const COLD_RESUME_MIN_MS = 90_000;

/** Legacy keys that must never drive navigation. */
export const STALE_LAST_ROUTE_KEYS = [
  "lastRoute",
  "last_route",
  "natalie_lastRoute",
  "natalie_last_route",
  "returnTo",
  "return_to",
  "savedPath",
  "lastPath",
  "last_path",
] as const;

export type AppLaunchDecision =
  | { action: "stay"; reason: string }
  | { action: "replace"; href: typeof APP_HOME_PATH; reason: string };

export function parseSearchParams(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

export function hasPwaLaunchMarker(search: string): boolean {
  return parseSearchParams(search).get(PWA_LAUNCH_PARAM) === PWA_LAUNCH_VALUE;
}

/** Remove the launch marker; preserve any other query params. */
export function stripPwaLaunchMarker(search: string): string {
  const params = parseSearchParams(search);
  params.delete(PWA_LAUNCH_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function isAlreadyHomePath(pathname: string): boolean {
  return pathname === APP_HOME_PATH || pathname === `${APP_HOME_PATH}/`;
}

export function isStandaloneDisplay(input: {
  matchMediaMatches?: (query: string) => boolean;
  iosStandalone?: boolean;
}): boolean {
  const matches = input.matchMediaMatches;
  if (matches?.("(display-mode: standalone)")) return true;
  if (matches?.("(display-mode: fullscreen)")) return true;
  if (matches?.("(display-mode: minimal-ui)")) return true;
  return Boolean(input.iosStandalone);
}

export function readPwaHiddenAt(storage: Pick<Storage, "getItem">): number | null {
  const raw = storage.getItem(PWA_HIDDEN_AT_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function writePwaHiddenAt(
  storage: Pick<Storage, "setItem">,
  atMs: number = Date.now()
): void {
  storage.setItem(PWA_HIDDEN_AT_KEY, String(atMs));
}

export function clearPwaHiddenAt(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(PWA_HIDDEN_AT_KEY);
}

/**
 * Decide whether to force home.
 * Prefer start_url marker; fall back to standalone cold-resume after long hide.
 */
export function resolveAppLaunchNavigation(input: {
  pathname: string;
  search?: string;
  navigationType?: string | null;
  isStandalone?: boolean;
  hiddenAtMs?: number | null;
  nowMs?: number;
  /** Ignored for routing — cleared separately; never restores a destination. */
  staleLastRoute?: string | null;
}): AppLaunchDecision {
  const search = input.search ?? "";
  const now = input.nowMs ?? Date.now();

  if (hasPwaLaunchMarker(search)) {
    return { action: "replace", href: APP_HOME_PATH, reason: "pwa_launch_home" };
  }

  if (input.navigationType === "reload") {
    return { action: "stay", reason: "reload" };
  }
  if (input.navigationType === "back_forward") {
    return { action: "stay", reason: "back_forward" };
  }

  if (isAlreadyHomePath(input.pathname)) {
    return { action: "stay", reason: "already_home" };
  }

  // Browser-tab deep links must never be forced home.
  if (!input.isStandalone) {
    if (input.staleLastRoute) {
      return { action: "stay", reason: "ignore_stale_last_route" };
    }
    return { action: "stay", reason: "not_standalone" };
  }

  const hiddenAt = input.hiddenAtMs ?? null;
  if (hiddenAt != null) {
    const gap = now - hiddenAt;
    if (gap >= COLD_RESUME_MIN_MS) {
      return { action: "replace", href: APP_HOME_PATH, reason: "standalone_cold_resume" };
    }
    return { action: "stay", reason: "short_background" };
  }

  if (input.staleLastRoute) {
    return { action: "stay", reason: "ignore_stale_last_route" };
  }

  return { action: "stay", reason: "no_pwa_launch_marker" };
}

export function resolveLoginSuccessPath(input: {
  mode: "login" | "signup";
  next: string | null;
}): string {
  if (input.mode === "signup") return "/onboarding";
  const next = input.next?.trim() ?? "";
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return APP_HOME_PATH;
}

export function clearStaleLastRouteKeys(storage: Pick<Storage, "removeItem">): void {
  for (const key of STALE_LAST_ROUTE_KEYS) {
    storage.removeItem(key);
  }
}

/** True when a replace would be a no-op loop (already clean home, no marker). */
export function wouldCreateLaunchLoop(input: {
  pathname: string;
  search?: string;
  decision: AppLaunchDecision;
}): boolean {
  if (input.decision.action !== "replace") return false;
  const search = input.search ?? "";
  return isAlreadyHomePath(input.pathname) && !hasPwaLaunchMarker(search);
}

export function readNavigationType(
  getEntriesByType: (type: string) => Array<{ type?: string }>
): string | null {
  try {
    const type = getEntriesByType("navigation")[0]?.type;
    return typeof type === "string" ? type : null;
  } catch {
    return null;
  }
}
