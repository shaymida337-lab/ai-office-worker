"use client";

import { useEffect, useState } from "react";
import { apiFetch, getToken } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { firstNameFromLabel } from "@/lib/dashboard/homePageHelpers";
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
        const workspace = settings.businessName?.trim() || settings.name?.trim() || "העסק שלי";
        setWorkspaceName(workspace);
        if (!localName) {
          setUserName(firstNameFromLabel(settings.name) || "שלום");
        }
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
