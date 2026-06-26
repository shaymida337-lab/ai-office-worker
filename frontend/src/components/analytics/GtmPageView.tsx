"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { isGoogleTagManagerEnabled } from "@/lib/analytics/constants";
import { trackGtmPageView } from "@/lib/analytics/data-layer";

export function GtmPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstPageView = useRef(true);

  useEffect(() => {
    if (!isGoogleTagManagerEnabled || !pathname) return;

    const query = searchParams.toString();
    const url = query ? `${pathname}?${query}` : pathname;

    if (isFirstPageView.current) {
      isFirstPageView.current = false;
      return;
    }

    trackGtmPageView(url);
  }, [pathname, searchParams]);

  return null;
}
