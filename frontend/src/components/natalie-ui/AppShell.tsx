"use client";

import type { ReactNode } from "react";
import { natalie } from "./tokens";

export function AppShell({
  children,
  header,
  bottomNavigation,
  floatingButton,
  headerOffset = "default",
}: {
  children: ReactNode;
  header?: ReactNode;
  bottomNavigation?: ReactNode;
  floatingButton?: ReactNode;
  headerOffset?: "default" | "tall";
}) {
  return (
    <div className={`min-h-screen ${natalie.page}`}>
      {header}
      <main
        className={`mx-auto w-full max-w-6xl px-4 pb-28 md:px-6 xl:max-w-7xl ${
          headerOffset === "tall" ? "pt-44 md:pt-48" : "pt-24 md:pt-28"
        }`}
      >
        {children}
      </main>
      {bottomNavigation}
      {floatingButton}
    </div>
  );
}
