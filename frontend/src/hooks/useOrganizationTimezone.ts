"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { DEFAULT_ORG_TIMEZONE } from "@/lib/orgTimezone";

let cachedTimezone: string | null = null;
let pendingFetch: Promise<string> | null = null;

async function loadOrganizationTimezone(): Promise<string> {
  if (cachedTimezone) return cachedTimezone;
  if (!pendingFetch) {
    pendingFetch = apiFetch<{ timezone?: string | null }>("/api/organization/settings")
      .then((settings) => {
        cachedTimezone = settings.timezone?.trim() || DEFAULT_ORG_TIMEZONE;
        return cachedTimezone;
      })
      .catch(() => {
        // כשל רשת לא מקבע תוצאה — ניסיון טעינה מחדש ב-mount הבא
        pendingFetch = null;
        return DEFAULT_ORG_TIMEZONE;
      });
  }
  return pendingFetch;
}

/**
 * timezone הארגון לתצוגה ול-prefill של טפסי יומן. עד שההגדרות נטענות
 * (או אם הבקשה נכשלת) מוחזר Asia/Jerusalem. ה-fetch משותף לכל הקומפוננטות
 * דרך cache ברמת המודול.
 */
export function useOrganizationTimezone(): string {
  const [timeZone, setTimeZone] = useState<string>(cachedTimezone ?? DEFAULT_ORG_TIMEZONE);

  useEffect(() => {
    let mounted = true;
    void loadOrganizationTimezone().then((zone) => {
      if (mounted) setTimeZone(zone);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return timeZone;
}
