"use client";

import { useEffect, useState } from "react";
import { getToken } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { resolvePersonalDisplayName, resolveWorkspaceDisplayName } from "@/lib/dashboard/homePageHelpers";
import {
  getCachedOrganizationSettings,
  loadOrganizationSettings,
  subscribeOrganizationSettings,
} from "@/lib/organization/organizationSettingsStore";
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

function namesFromSettings(settings: OrganizationSettings) {
  return {
    workspaceName: resolveWorkspaceDisplayName(settings),
    userName: resolvePersonalDisplayName(settings) || "שלום",
  };
}

export function useGlobalHeaderProfile(): GlobalHeaderProfile {
  const cached = getCachedOrganizationSettings();
  const initial = cached ? namesFromSettings(cached) : null;
  const [workspaceName, setWorkspaceName] = useState(initial?.workspaceName ?? "העסק שלי");
  const [userName, setUserName] = useState(() => initial?.userName || readLocalUserName() || "שלום");
  const [loading, setLoading] = useState(() => !cached);

  useEffect(() => {
    // Temporary hint only until settings resolve — never wipe a known name on refresh.
    const localName = readLocalUserName();
    if (localName && !getCachedOrganizationSettings()) setUserName(localName);

    const apply = (settings: OrganizationSettings) => {
      const next = namesFromSettings(settings);
      setWorkspaceName(next.workspaceName);
      setUserName(next.userName);
      setLoading(false);
    };

    const unsub = subscribeOrganizationSettings(() => {
      const next = getCachedOrganizationSettings();
      if (next) apply(next);
    });

    const token = getToken();
    if (!token) {
      setLoading(false);
      return () => {
        unsub();
      };
    }

    const existing = getCachedOrganizationSettings();
    if (existing) apply(existing);

    void loadOrganizationSettings()
      .then(apply)
      .catch(() => {
        // Keep prior workspace/user names; no global loading wipe.
        setLoading(false);
      });

    return () => {
      unsub();
    };
  }, []);

  return { userName, workspaceName, loading };
}
