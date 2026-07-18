"use client";

import { apiFetch, getToken } from "@/lib/api";
import { crmListCacheKey, getCrmListCache, setCrmListCache, type CrmListCachePayload } from "./crmListCache";

let prefetchInFlight: Promise<void> | null = null;
let routePrefetched = false;

type PrefetchRouter = { prefetch: (href: string) => void };

/** Prefetch /crm route chunk + warm GET /api/leads into the CRM list cache. */
export function prefetchCrm(router?: PrefetchRouter): void {
  if (typeof window === "undefined") return;

  if (router && !routePrefetched) {
    routePrefetched = true;
    try {
      router.prefetch("/crm");
    } catch {
      // ignore
    }
  }

  if (!getToken()) return;
  if (getCrmListCache(crmListCacheKey())) return;
  if (prefetchInFlight) return;

  prefetchInFlight = apiFetch<CrmListCachePayload>("/api/leads")
    .then((data) => {
      if (data?.leads) setCrmListCache(crmListCacheKey(), data);
    })
    .catch(() => undefined)
    .finally(() => {
      prefetchInFlight = null;
    });
}
