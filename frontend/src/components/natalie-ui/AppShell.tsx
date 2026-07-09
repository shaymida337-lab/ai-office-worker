"use client";

import type { ReactNode } from "react";
import { natalie } from "./tokens";

export function AppShell({
  children,
  header,
  bottomNavigation,
  floatingButton,
}: {
  children: ReactNode;
  header?: ReactNode;
  bottomNavigation?: ReactNode;
  floatingButton?: ReactNode;
}) {
  return (
    <div className={natalie.page}>
      {header}
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-24 md:px-6 md:pt-28 xl:max-w-7xl">{children}</main>
      {bottomNavigation}
      {floatingButton}
    </div>
  );
}
