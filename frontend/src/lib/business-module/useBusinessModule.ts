"use client";

import { useEffect, useState } from "react";
import type { OrganizationSettings } from "@/lib/business-config";
import {
  getCachedOrganizationSettings,
  loadOrganizationSettings,
  subscribeOrganizationSettings,
} from "@/lib/organization/organizationSettingsStore";
import { getBusinessModule } from "./getBusinessModule";
import type { BusinessModuleConfig } from "./types";

type UseBusinessModuleResult = {
  module: BusinessModuleConfig;
  loading: boolean;
  error: string;
  settings: OrganizationSettings | null;
};

/**
 * Loads organization settings once and resolves the business module.
 * Screens should consume `module` — not raw businessType conditionals.
 */
export function useBusinessModule(): UseBusinessModuleResult {
  const cached = getCachedOrganizationSettings();
  const [module, setModule] = useState<BusinessModuleConfig>(() =>
    getBusinessModule(cached?.businessType ?? "service_business")
  );
  const [settings, setSettings] = useState<OrganizationSettings | null>(cached);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const apply = (next: OrganizationSettings) => {
      if (cancelled) return;
      setSettings(next);
      setModule(getBusinessModule(next.businessType));
      setError("");
      setLoading(false);
    };

    const unsub = subscribeOrganizationSettings(() => {
      const next = getCachedOrganizationSettings();
      if (next) apply(next);
    });

    if (cached) apply(cached);

    void loadOrganizationSettings()
      .then(apply)
      .catch((err) => {
        if (cancelled) return;
        // Keep prior settings/module on refresh failure.
        if (!getCachedOrganizationSettings()) {
          setError(err instanceof Error ? err.message : "טעינת הגדרות העסק נכשלה");
          setModule(getBusinessModule("service_business"));
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { module, loading, error, settings };
}
