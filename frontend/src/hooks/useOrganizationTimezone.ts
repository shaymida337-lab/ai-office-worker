"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ORG_TIMEZONE } from "@/lib/orgTimezone";
import {
  getCachedOrganizationSettings,
  loadOrganizationSettings,
  subscribeOrganizationSettings,
} from "@/lib/organization/organizationSettingsStore";

function timezoneFromCache(): string {
  const cached = getCachedOrganizationSettings();
  return cached?.timezone?.trim() || DEFAULT_ORG_TIMEZONE;
}

/**
 * timezone הארגון לתצוגה ול-prefill של טפסי יומן. עד שההגדרות נטענות
 * (או אם הבקשה נכשלת) מוחזר Asia/Jerusalem. ה-fetch משותף לכל הקומפוננטות
 * דרך organizationSettingsStore.
 */
export function useOrganizationTimezone(): string {
  const [timeZone, setTimeZone] = useState<string>(timezoneFromCache);

  useEffect(() => {
    let mounted = true;
    const apply = () => {
      if (mounted) setTimeZone(timezoneFromCache());
    };
    const unsub = subscribeOrganizationSettings(apply);
    void loadOrganizationSettings()
      .then(() => {
        apply();
      })
      .catch(() => {
        // Keep prior / default timezone on refresh failure.
        apply();
      });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return timeZone;
}
