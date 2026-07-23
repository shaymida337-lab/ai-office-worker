"use client";

import { useEffect, useState } from "react";
import {
  getCachedIsPlatformAdmin,
  loadIsPlatformAdmin,
  subscribeLeadAdminSummary,
} from "@/lib/admin/leadAdminSummaryStore";

/**
 * Shared platform-admin flag (from GET /api/auth/platform-admin).
 * null = unknown / loading; false = regular user; true = platform admin.
 * Safe for regular users — never hits marketing-leads.
 */
export function useIsPlatformAdmin(): boolean | null {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => getCachedIsPlatformAdmin());

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled) setIsAdmin(getCachedIsPlatformAdmin());
    };
    const unsubscribe = subscribeLeadAdminSummary(sync);
    void loadIsPlatformAdmin()
      .then((value) => {
        if (!cancelled) setIsAdmin(value);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return isAdmin;
}
