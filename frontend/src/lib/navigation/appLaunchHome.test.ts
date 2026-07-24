import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_HOME_PATH,
  COLD_RESUME_MIN_MS,
  clearPwaHiddenAt,
  clearStaleLastRouteKeys,
  hasPwaLaunchMarker,
  isStandaloneDisplay,
  PWA_HIDDEN_AT_KEY,
  PWA_START_URL,
  readPwaHiddenAt,
  resolveAppLaunchNavigation,
  resolveLoginSuccessPath,
  STALE_LAST_ROUTE_KEYS,
  stripPwaLaunchMarker,
  wouldCreateLaunchLoop,
  writePwaHiddenAt,
} from "./appLaunchHome.ts";

test("PWA start_url marker → clean dashboard", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard",
    search: "?source=pwa",
  });
  assert.deepEqual(d, { action: "replace", href: APP_HOME_PATH, reason: "pwa_launch_home" });
  assert.equal(stripPwaLaunchMarker("?source=pwa"), "");
});

test("close on settings → reopen icon (cold resume) → dashboard", () => {
  const now = 1_000_000;
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: true,
    hiddenAtMs: now - COLD_RESUME_MIN_MS - 1,
    nowMs: now,
    navigationType: "navigate",
  });
  assert.deepEqual(d, {
    action: "replace",
    href: "/dashboard",
    reason: "standalone_cold_resume",
  });
});

test("reload settings → settings", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: true,
    hiddenAtMs: Date.now() - COLD_RESUME_MIN_MS * 2,
    navigationType: "reload",
  });
  assert.deepEqual(d, { action: "stay", reason: "reload" });
});

test("direct settings URL (browser) → settings", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: false,
  });
  assert.deepEqual(d, { action: "stay", reason: "not_standalone" });
});

test("direct calendar / clients / reports stay without marker", () => {
  for (const pathname of ["/dashboard/calendar", "/dashboard/clients", "/reports"]) {
    const d = resolveAppLaunchNavigation({ pathname, isStandalone: false });
    assert.equal(d.action, "stay");
  }
});

test("short background return → stays settings", () => {
  const now = 500_000;
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: true,
    hiddenAtMs: now - 5_000,
    nowMs: now,
    navigationType: "navigate",
  });
  assert.deepEqual(d, { action: "stay", reason: "short_background" });
});

test("full close / long background → dashboard", () => {
  const now = 800_000;
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: true,
    hiddenAtMs: now - COLD_RESUME_MIN_MS,
    nowMs: now,
  });
  assert.equal(d.action, "replace");
  assert.equal(d.action === "replace" ? d.reason : "", "standalone_cold_resume");
});

test("back/forward preserved", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: true,
    hiddenAtMs: Date.now() - COLD_RESUME_MIN_MS * 2,
    navigationType: "back_forward",
  });
  assert.deepEqual(d, { action: "stay", reason: "back_forward" });
});

test("no redirect loop after landing on clean dashboard", () => {
  assert.equal(
    wouldCreateLaunchLoop({
      pathname: "/dashboard",
      search: "",
      decision: { action: "replace", href: "/dashboard", reason: "standalone_cold_resume" },
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

test("start_url marker still wins when present", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    search: "?source=pwa",
    isStandalone: true,
    hiddenAtMs: null,
  });
  assert.deepEqual(d, { action: "replace", href: "/dashboard", reason: "pwa_launch_home" });
});

test("login/onboarding redirects stay correct", () => {
  assert.equal(resolveLoginSuccessPath({ mode: "login", next: null }), "/dashboard");
  assert.equal(resolveLoginSuccessPath({ mode: "signup", next: null }), "/onboarding");
  assert.equal(
    resolveLoginSuccessPath({ mode: "login", next: "/dashboard/settings?tab=integrations" }),
    "/dashboard/settings?tab=integrations"
  );
});

test("stale lastRoute never forces home alone", () => {
  const d = resolveAppLaunchNavigation({
    pathname: "/dashboard/settings",
    isStandalone: false,
    staleLastRoute: "/dashboard/settings",
  });
  assert.deepEqual(d, { action: "stay", reason: "ignore_stale_last_route" });
});

test("hiddenAt storage helpers", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  writePwaHiddenAt(storage, 12345);
  assert.equal(readPwaHiddenAt(storage), 12345);
  assert.equal(map.get(PWA_HIDDEN_AT_KEY), "12345");
  clearPwaHiddenAt(storage);
  assert.equal(readPwaHiddenAt(storage), null);
});

test("standalone display detection", () => {
  assert.equal(
    isStandaloneDisplay({ matchMediaMatches: (q) => q.includes("standalone") }),
    true
  );
  assert.equal(isStandaloneDisplay({ matchMediaMatches: () => false, iosStandalone: true }), true);
  assert.equal(isStandaloneDisplay({ matchMediaMatches: () => false }), false);
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

test("manifest start_url + launch_handler navigate-existing", () => {
  const raw = readFileSync(join(process.cwd(), "public/site.webmanifest"), "utf8");
  const manifest = JSON.parse(raw) as {
    start_url?: string;
    display?: string;
    launch_handler?: { client_mode?: string };
  };
  assert.equal(manifest.start_url, PWA_START_URL);
  assert.equal(manifest.start_url, "/dashboard?source=pwa");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.launch_handler?.client_mode, "navigate-existing");
  assert.equal(hasPwaLaunchMarker(new URL(manifest.start_url!, "https://example.com").search), true);
});
