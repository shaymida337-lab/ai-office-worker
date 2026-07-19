"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { resolvePersonalDisplayName, resolveWorkspaceDisplayName } from "@/lib/dashboard/homePageHelpers";
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
    // Temporary hint only until /api/organization/settings returns.
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
        setWorkspaceName(resolveWorkspaceDisplayName(settings));
        // Personal subtitle from settings.name — never businessName; localStorage must not win.
        setUserName(resolvePersonalDisplayName(settings) || "שלום");
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
