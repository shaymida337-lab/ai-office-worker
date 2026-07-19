"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { resolveWorkspaceDisplayName } from "@/lib/dashboard/homePageHelpers";
import { readFirstDayData, readOnboardingProgress } from "@/lib/natalie/firstDay";

export type GlobalHeaderProfile = {
  userName: string;
  workspaceName: string;
  loading: boolean;
};

function readLocalUserName() {
  const firstDay = readFirstDayData();
  if (firstDay?.firstName?.trim()) return firstDay.firstName.trim();
  const onboarding = readOnboardingProgress();
  if (onboarding?.firstName?.trim()) return onboarding.firstName.trim();
  return "";
}

export function useGlobalHeaderProfile(): GlobalHeaderProfile {
  const [workspaceName, setWorkspaceName] = useState("העסק שלי");
  const [userName, setUserName] = useState(() => readLocalUserName() || "שלום");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // localStorage is only a temporary hint until /api/organization/settings returns.
    // Stale first-day / onboarding names must not override the server profile.
    const localName = readLocalUserName();
    if (localName) setUserName(localName);

    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    let mounted = true;
    void apiFetch<OrganizationSettings>("/api/organization/settings")
      .then((settings) => {
        if (!mounted) return;
        const workspace = resolveWorkspaceDisplayName(settings);
        setWorkspaceName(workspace);
        // Single source of truth with the home greeting / page title: workspace display name.
        setUserName(workspace);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { userName, workspaceName, loading };
}
