"use client";

import type { ReactNode } from "react";
import { GlobalBottomNavigation } from "./GlobalBottomNavigation";
import { GlobalHeader } from "./GlobalHeader";
import { natalie, shellLayout } from "./tokens";

export function AppShell({
  children,
  pageTitle,
  bottomNavigation,
  floatingButton,
  showGlobalHeader = true,
  showBottomNavigation = true,
  mainClassName = "",
}: {
  children: ReactNode;
  pageTitle?: ReactNode;
  /** Override default Bolt bottom nav. Pass `null` to hide. */
  bottomNavigation?: ReactNode | null;
  floatingButton?: ReactNode;
  showGlobalHeader?: boolean;
  showBottomNavigation?: boolean;
  mainClassName?: string;
}) {
  const mainOffset = pageTitle ? shellLayout.headerWithTitleOffset : shellLayout.headerOffset;

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
      <main
        className={`${shellLayout.contentMaxWidth} ${shellLayout.contentPaddingX} ${shellLayout.mainPaddingTop} ${shellLayout.mainPaddingBottom} ${mainOffset} ${mainClassName}`}
      >
        {children}
      </main>
      {resolvedBottomNav}
      {floatingButton}
    </div>
  );
}
