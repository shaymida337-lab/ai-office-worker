"use client";

import type { ReactNode } from "react";
import { GlobalHeader } from "./GlobalHeader";
import { natalie } from "./tokens";

export function AppShell({
  children,
  pageTitle,
  bottomNavigation,
  floatingButton,
  showGlobalHeader = true,
}: {
  children: ReactNode;
  pageTitle?: ReactNode;
  bottomNavigation?: ReactNode;
  floatingButton?: ReactNode;
  showGlobalHeader?: boolean;
}) {
  const mainOffset = pageTitle
    ? "pt-[calc(8.75rem+env(safe-area-inset-top,0px))] md:pt-[calc(9.25rem+env(safe-area-inset-top,0px))]"
    : "pt-[calc(3.5rem+env(safe-area-inset-top,0px))]";

  return (
    <div className={`min-h-screen ${natalie.page}`}>
      {showGlobalHeader ? (
        <div className="fixed inset-x-0 top-0 z-40">
          <GlobalHeader />
          {pageTitle}
        </div>
      ) : null}
      <main className={`mx-auto w-full max-w-6xl px-4 pb-28 md:px-6 xl:max-w-7xl ${mainOffset}`}>{children}</main>
      {bottomNavigation}
      {floatingButton}
    </div>
  );
}
