"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  clearStaleLastRouteKeys,
  hasPwaLaunchMarker,
  resolveAppLaunchNavigation,
  wouldCreateLaunchLoop,
} from "@/lib/navigation/appLaunchHome";

/**
 * Handles PWA icon launches only: start_url includes ?source=pwa, then we
 * replace to a clean /dashboard. Direct deep links are never overridden.
 */
export function AppLaunchHomeRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const handledLaunchRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    clearStaleLastRouteKeys(window.localStorage);

    const search = window.location.search;
    const path = pathname || window.location.pathname;

    // One-shot per marker presence — avoids replace loops after stripping.
    if (!hasPwaLaunchMarker(search)) {
      handledLaunchRef.current = false;
      return;
    }
    if (handledLaunchRef.current) return;

    const decision = resolveAppLaunchNavigation({
      pathname: path,
      search,
      staleLastRoute: window.localStorage.getItem("lastRoute"),
    });

    if (wouldCreateLaunchLoop({ pathname: path, search, decision })) return;
    if (decision.action !== "replace") return;

    handledLaunchRef.current = true;
    router.replace(decision.href);
  }, [pathname, router]);

  return null;
}
