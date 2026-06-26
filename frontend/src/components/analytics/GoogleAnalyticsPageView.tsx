"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { isGoogleAnalyticsEnabled } from "@/lib/analytics/constants";
import { trackPageView } from "@/lib/analytics/gtag";

export function GoogleAnalyticsPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstPageView = useRef(true);

  useEffect(() => {
    if (!isGoogleAnalyticsEnabled || !pathname) return;

    const query = searchParams.toString();
    const url = query ? `${pathname}?${query}` : pathname;

    if (isFirstPageView.current) {
      isFirstPageView.current = false;
      return;
    }

    trackPageView(url);
  }, [pathname, searchParams]);

  return null;
}
