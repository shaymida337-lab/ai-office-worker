"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

export type LeadAdminSummary = {
  newCount: number;
  today: number;
  week: number;
  month: number;
  qualified: number;
  converted: number;
  latestCreatedAt: string | null;
};

const POLL_MS = 8_000; // "אני יודע על ליד תוך פחות מ-10 שניות"

/**
 * סיכום לידים לאדמין פלטפורמה, עם polling.
 * מי שאינו אדמין מקבל 403 בבדיקת הפתיחה — ה-hook נעצר ולא ממשיך לשאול.
 */
export function useLeadAdminSummary(enabled = true) {
  const [summary, setSummary] = useState<LeadAdminSummary | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [hasNewSince, setHasNewSince] = useState(false);
  const lastSeenLatestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | null = null;

    async function poll() {
      try {
        const data = await apiFetch<LeadAdminSummary>("/api/admin/marketing-leads/summary");
        if (cancelled) return;
        setIsAdmin(true);
        setSummary(data);
        if (
          lastSeenLatestRef.current !== null &&
          data.latestCreatedAt !== null &&
          data.latestCreatedAt !== lastSeenLatestRef.current
        ) {
          setHasNewSince(true); // ליד חדש נכנס מאז הטעינה — טריגר לצליל
        }
        lastSeenLatestRef.current = data.latestCreatedAt;
        timer = window.setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          setIsAdmin(false); // לא אדמין — מפסיקים לשאול לצמיתות
          return;
        }
        timer = window.setTimeout(poll, POLL_MS * 3); // שגיאת רשת — ננסה שוב לאט
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);

  return { summary, isAdmin, hasNewSince, ackNewSince: () => setHasNewSince(false) };
}
