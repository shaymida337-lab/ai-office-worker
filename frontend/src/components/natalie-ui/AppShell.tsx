"use client";

import type { ReactNode } from "react";
import { GlobalBottomNavigation } from "./GlobalBottomNavigation";
import { GlobalHeader } from "./GlobalHeader";
import { natalie } from "./tokens";

export function AppShell({
  children,
  pageTitle,
  bottomNavigation,
  floatingButton,
  showGlobalHeader = true,
  showBottomNavigation = true,
}: {
  children: ReactNode;
  pageTitle?: ReactNode;
  /** Override default Bolt bottom nav. Pass `null` to hide. */
  bottomNavigation?: ReactNode | null;
  floatingButton?: ReactNode;
  showGlobalHeader?: boolean;
  showBottomNavigation?: boolean;
}) {
  const mainOffset = pageTitle
    ? "pt-[calc(9.5rem+env(safe-area-inset-top,0px))] md:pt-[calc(10rem+env(safe-area-inset-top,0px))]"
    : "pt-[calc(4.5rem+env(safe-area-inset-top,0px))]";

  const resolvedBottomNav =
    bottomNavigation === null || !showBottomNavigation ? null : bottomNavigation ?? <GlobalBottomNavigation />;

  return (
    <div className={`min-h-screen ${natalie.page}`}>
      {showGlobalHeader ? (
        <div className="fixed inset-x-0 top-0 z-40">
          <GlobalHeader />
          {pageTitle}
        </div>
      ) : null}
      <main className={`mx-auto w-full max-w-6xl px-4 pb-28 md:px-6 xl:max-w-7xl ${mainOffset}`}>{children}</main>
      {resolvedBottomNav}
      {floatingButton}
    </div>
  );
}
