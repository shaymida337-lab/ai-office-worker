"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GlobalBottomNavigation, GlobalHeader } from "@/components/natalie-ui";
import { loadOrganizationSettings } from "@/lib/organization/organizationSettingsStore";

/**
 * Product chrome for screens that still mount `<Nav />`.
 * Layout matches AppShell: GlobalHeader → page content → GlobalBottomNavigation.
 * No desktop sidebar — primary navigation is bottom nav only.
 */
export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    void loadOrganizationSettings()
      .then((settings) => {
        if (settings.onboardingRequired && pathname !== "/onboarding") {
          router.replace("/onboarding");
        }
      })
      .catch(() => undefined);
  }, [pathname, router]);

  return (
    <>
      <GlobalHeader
        notificationCount={1}
        onNotificationsClick={() => router.push("/message-scans")}
      />
      <GlobalBottomNavigation />
    </>
  );
}
