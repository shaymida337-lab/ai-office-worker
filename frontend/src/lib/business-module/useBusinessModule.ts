"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { OrganizationSettings } from "@/lib/business-config";
import { getBusinessModule, type BusinessModuleConfig } from "@/lib/business-module";

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
  const [module, setModule] = useState<BusinessModuleConfig>(() => getBusinessModule("service_business"));
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<OrganizationSettings>("/api/organization/settings")
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setModule(getBusinessModule(next.businessType));
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "טעינת הגדרות העסק נכשלה");
        setModule(getBusinessModule("service_business"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { module, loading, error, settings };
}
