/**
 * PWA icon launch → always land on a clean /dashboard.
 *
 * Manifest start_url carries an internal marker (?source=pwa). The redirect
 * component strips it with replace. Direct URLs without the marker are never
 * overridden — including /dashboard/settings and other shell routes.
 */

export const APP_HOME_PATH = "/dashboard";
export const PWA_LAUNCH_PARAM = "source";
export const PWA_LAUNCH_VALUE = "pwa";
/** Must stay in sync with public/site.webmanifest start_url. */
export const PWA_START_URL = `${APP_HOME_PATH}?${PWA_LAUNCH_PARAM}=${PWA_LAUNCH_VALUE}`;

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

/** Remove the launch marker; preserve any other query params (should be none on start_url). */
export function stripPwaLaunchMarker(search: string): string {
  const params = parseSearchParams(search);
  params.delete(PWA_LAUNCH_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function isAlreadyHomePath(pathname: string): boolean {
  return pathname === APP_HOME_PATH || pathname === `${APP_HOME_PATH}/`;
}

/**
 * Only the PWA start_url launch marker forces home.
 * Direct deep links (with or without query) stay put.
 */
export function resolveAppLaunchNavigation(input: {
  pathname: string;
  search?: string;
  /** Ignored for routing — cleared separately; never restores a destination. */
  staleLastRoute?: string | null;
  navigationType?: string | null;
}): AppLaunchDecision {
  const search = input.search ?? "";

  // Reload / back_forward without the launch marker: never invent a home redirect.
  if (!hasPwaLaunchMarker(search)) {
    if (input.navigationType === "reload") {
      return { action: "stay", reason: "reload" };
    }
    if (input.navigationType === "back_forward") {
      return { action: "stay", reason: "back_forward" };
    }
    // Stale lastRoute must not control anything.
    if (input.staleLastRoute) {
      return { action: "stay", reason: "ignore_stale_last_route" };
    }
    return { action: "stay", reason: "no_pwa_launch_marker" };
  }

  // Icon / start_url launch: always clean /dashboard (marker removed via replace).
  return { action: "replace", href: APP_HOME_PATH, reason: "pwa_launch_home" };
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
