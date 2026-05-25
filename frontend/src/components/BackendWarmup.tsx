"use client";

import { useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function BackendWarmup() {
  useEffect(() => {
    const ping = () => {
      fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => undefined);
    };

    ping();
    const interval = window.setInterval(ping, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
