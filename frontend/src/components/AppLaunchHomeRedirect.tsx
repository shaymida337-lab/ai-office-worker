"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  APP_HOME_PATH,
  clearPwaHiddenAt,
  clearStaleLastRouteKeys,
  hasPwaLaunchMarker,
  isStandaloneDisplay,
  readNavigationType,
  readPwaHiddenAt,
  resolveAppLaunchNavigation,
  wouldCreateLaunchLoop,
  writePwaHiddenAt,
} from "@/lib/navigation/appLaunchHome";

/**
 * PWA home policy:
 * - ?source=pwa (start_url) → replace to clean /dashboard
 * - standalone cold-resume after long hide → replace once to /dashboard
 * Direct deep links / reload / back / short background are untouched.
 */
export function AppLaunchHomeRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const handledReplaceRef = useRef(false);
  const launchQueueBoundRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    clearStaleLastRouteKeys(window.localStorage);

    const evaluate = () => {
      const search = window.location.search;
      const path = pathname || window.location.pathname;
      const standalone = isStandaloneDisplay({
        matchMediaMatches: (q) => window.matchMedia(q).matches,
        iosStandalone: Boolean(
          (window.navigator as Navigator & { standalone?: boolean }).standalone
        ),
      });

      const decision = resolveAppLaunchNavigation({
        pathname: path,
        search,
        navigationType: readNavigationType((type) =>
          performance.getEntriesByType(type) as Array<{ type?: string }>
        ),
        isStandalone: standalone,
        hiddenAtMs: readPwaHiddenAt(window.localStorage),
        staleLastRoute: window.localStorage.getItem("lastRoute"),
      });

      if (wouldCreateLaunchLoop({ pathname: path, search, decision })) return;
      if (decision.action !== "replace") return;
      if (handledReplaceRef.current) return;

      handledReplaceRef.current = true;
      clearPwaHiddenAt(window.localStorage);
      router.replace(decision.href);
    };

    evaluate();

    const onHide = () => {
      if (document.visibilityState === "visible") return;
      const standalone = isStandaloneDisplay({
        matchMediaMatches: (q) => window.matchMedia(q).matches,
        iosStandalone: Boolean(
          (window.navigator as Navigator & { standalone?: boolean }).standalone
        ),
      });
      if (!standalone) return;
      writePwaHiddenAt(window.localStorage);
    };

    const onPageShow = () => {
      handledReplaceRef.current = false;
      evaluate();
    };

    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onPageShow);

    const launchQueue = (
      window as Window & {
        launchQueue?: { setConsumer: (cb: (params: { targetURL?: string }) => void) => void };
      }
    ).launchQueue;
    if (launchQueue?.setConsumer && !launchQueueBoundRef.current) {
      launchQueueBoundRef.current = true;
      launchQueue.setConsumer((params) => {
        const target = params.targetURL ?? "";
        try {
          if (hasPwaLaunchMarker(new URL(target, window.location.origin).search)) {
            handledReplaceRef.current = false;
            clearPwaHiddenAt(window.localStorage);
            router.replace(APP_HOME_PATH);
            return;
          }
        } catch {
          // ignore malformed launch URLs
        }
        handledReplaceRef.current = false;
        evaluate();
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pathname, router]);

  return null;
}
