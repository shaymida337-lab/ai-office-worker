import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_HOME_PATH,
  clearStaleLastRouteKeys,
  hasPwaLaunchMarker,
  PWA_START_URL,
  resolveAppLaunchNavigation,
  resolveLoginSuccessPath,
  STALE_LAST_ROUTE_KEYS,
  stripPwaLaunchMarker,
  wouldCreateLaunchLoop,
} from "./appLaunchHome.ts";

test("PWA start_url → clean dashboard", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard",
    search: "?source=pwa",
  });
  assert.deepEqual(d, { action: "replace", href: APP_HOME_PATH, reason: "pwa_launch_home" });
  assert.equal(stripPwaLaunchMarker("?source=pwa"), "");
});

test("previous route=settings + PWA launch marker → dashboard", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard",
    search: "?source=pwa",
    staleLastRoute: "/dashboard/settings",
  });
  assert.deepEqual(d, { action: "replace", href: "/dashboard", reason: "pwa_launch_home" });
});

test("direct /dashboard/settings → settings", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    search: "",
  });
  assert.deepEqual(d, { action: "stay", reason: "no_pwa_launch_marker" });
});

test("direct /dashboard/calendar → calendar", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/calendar",
  });
  assert.deepEqual(d, { action: "stay", reason: "no_pwa_launch_marker" });
});

test("direct /dashboard/clients → clients", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/clients",
  });
  assert.deepEqual(d, { action: "stay", reason: "no_pwa_launch_marker" });
});

test("direct /reports → reports", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/reports",
  });
  assert.deepEqual(d, { action: "stay", reason: "no_pwa_launch_marker" });
});

test("reload settings → settings", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    search: "",
    navigationType: "reload",
  });
  assert.deepEqual(d, { action: "stay", reason: "reload" });
});

test("back/forward preserved", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    navigationType: "back_forward",
  });
  assert.deepEqual(d, { action: "stay", reason: "back_forward" });
});

test("launch marker is stripped from URL helpers", () => {
  assert.equal(hasPwaLaunchMarker("?source=pwa"), true);
  assert.equal(hasPwaLaunchMarker("?tab=integrations"), false);
  assert.equal(stripPwaLaunchMarker("?source=pwa"), "");
  assert.equal(stripPwaLaunchMarker("?source=pwa&tab=x"), "?tab=x");
});

test("no replace loop after marker already removed", () => {
  const decision = resolveAppLaunchNavigation({
    pathname: "/dashboard",
    search: "",
  });
  assert.equal(decision.action, "stay");
  assert.equal(
    wouldCreateLaunchLoop({
      pathname: "/dashboard",
      search: "",
      decision: { action: "replace", href: "/dashboard", reason: "pwa_launch_home" },
    }),
    true
  );
  assert.equal(
    wouldCreateLaunchLoop({
      pathname: "/dashboard",
      search: "?source=pwa",
      decision: { action: "replace", href: "/dashboard", reason: "pwa_launch_home" },
    }),
    false
  );
});

test("onboarding path is not forced home without launch marker", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/onboarding",
  });
  assert.deepEqual(d, { action: "stay", reason: "no_pwa_launch_marker" });
});

test("login redirects stay correct", () => {
  assert.equal(resolveLoginSuccessPath({ mode: "login", next: null }), "/dashboard");
  assert.equal(resolveLoginSuccessPath({ mode: "signup", next: null }), "/onboarding");
  assert.equal(
    resolveLoginSuccessPath({ mode: "login", next: "/dashboard/settings?tab=integrations" }),
    "/dashboard/settings?tab=integrations"
  );
  assert.equal(resolveLoginSuccessPath({ mode: "login", next: "//evil.example" }), "/dashboard");
});

test("stale lastRoute=settings does not control without launch marker", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    staleLastRoute: "/dashboard/settings",
  });
  assert.deepEqual(d, { action: "stay", reason: "ignore_stale_last_route" });
});

test("clearStaleLastRouteKeys removes known keys", () => {
  const map = new Map<string, string>();
  for (const key of STALE_LAST_ROUTE_KEYS) map.set(key, "/dashboard/settings");
  clearStaleLastRouteKeys({
    removeItem: (k: string) => {
      map.delete(k);
    },
  });
  for (const key of STALE_LAST_ROUTE_KEYS) assert.equal(map.has(key), false);
});

test("PWA manifest start_url carries launch marker", () => {
  const raw = readFileSync(join(process.cwd(), "public/site.webmanifest"), "utf8");
  const manifest = JSON.parse(raw) as { start_url?: string; display?: string };
  assert.equal(manifest.start_url, PWA_START_URL);
  assert.equal(manifest.start_url, "/dashboard?source=pwa");
  assert.equal(manifest.display, "standalone");
  assert.equal(hasPwaLaunchMarker(new URL(manifest.start_url!, "https://example.com").search), true);
});
