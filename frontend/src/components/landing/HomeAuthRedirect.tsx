"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/**
 * PWA / home entry: if an existing session token is present, skip the marketing
 * page and enter the app. Unauthenticated users see the landing as usual.
 */
export function HomeAuthRedirect({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [showLanding, setShowLanding] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
      return;
    }
    setShowLanding(true);
  }, [router]);

  if (!showLanding) return null;
  return children;
}
