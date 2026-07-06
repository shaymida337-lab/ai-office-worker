"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import {
  getFrontendCommit,
  resolveSystemDeployStatus,
  systemDeployBannerMessage,
  systemDeployOkMessage,
  type PublicHealthResponse,
  type SystemDeployStatus,
} from "@/lib/systemDeployStatus";

export function useSystemDeployStatus(pollMs = 60_000) {
  const [status, setStatus] = useState<SystemDeployStatus>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
        const health = (await res.json().catch(() => null)) as PublicHealthResponse | null;
        if (cancelled) return;
        setStatus(
          resolveSystemDeployStatus({
            health,
            healthOk: res.ok,
            frontendCommit: getFrontendCommit(),
          })
        );
      } catch {
        if (!cancelled) {
          setStatus(
            resolveSystemDeployStatus({
              health: null,
              healthOk: false,
              frontendCommit: getFrontendCommit(),
            })
          );
        }
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return {
    status,
    bannerMessage: systemDeployBannerMessage(status),
    okMessage: systemDeployOkMessage(status),
    isDegraded: status.state !== "ok" && status.state !== "checking",
  };
}
