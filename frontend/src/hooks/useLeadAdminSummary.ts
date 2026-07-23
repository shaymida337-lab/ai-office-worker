"use client";

import { useEffect, useRef, useState } from "react";
import {
  getCachedLeadAdminSummary,
  loadLeadAdminSummary,
  refreshLeadAdminSummary,
  subscribeLeadAdminSummary,
  type LeadAdminSummary,
} from "@/lib/admin/leadAdminSummaryStore";

export type { LeadAdminSummary };

const POLL_MS = 8_000; // "אני יודע על ליד תוך פחות מ-10 שניות"

/**
 * סיכום לידים לאדמין פלטפורמה, עם polling.
 * מופעל רק כש-enabled=true (אחרי שער platform-admin) — לא שולח marketing-leads למשתמש רגיל.
 * כמה צרכנים חולקים cache + in-flight אחד דרך leadAdminSummaryStore.
 */
export function useLeadAdminSummary(enabled = true) {
  const [summary, setSummary] = useState<LeadAdminSummary | null>(() =>
    enabled ? getCachedLeadAdminSummary() : null
  );
  const [hasNewSince, setHasNewSince] = useState(false);
  const lastSeenLatestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const apply = (data: LeadAdminSummary | null) => {
      if (cancelled || !data) return;
      setSummary(data);
      if (
        lastSeenLatestRef.current !== null &&
        data.latestCreatedAt !== null &&
        data.latestCreatedAt !== lastSeenLatestRef.current
      ) {
        setHasNewSince(true);
      }
      lastSeenLatestRef.current = data.latestCreatedAt;
    };

    const unsubscribe = subscribeLeadAdminSummary(() => {
      apply(getCachedLeadAdminSummary());
    });

    async function poll(initial: boolean) {
      try {
        const data = initial ? await loadLeadAdminSummary() : await refreshLeadAdminSummary();
        apply(data);
        if (!cancelled) timer = window.setTimeout(() => void poll(false), POLL_MS);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void poll(false), POLL_MS * 3);
      }
    }

    void poll(true);
    return () => {
      cancelled = true;
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  return {
    summary,
    isAdmin: enabled,
    hasNewSince,
    ackNewSince: () => setHasNewSince(false),
  };
}
