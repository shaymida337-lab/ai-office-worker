"use client";

import type { ReactNode } from "react";

export function AppShell({
  children,
  header,
  bottomNavigation,
  floatingButton,
}: {
  children: ReactNode;
  header: ReactNode;
  bottomNavigation: ReactNode;
  floatingButton: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F3F6FF] text-[#0F172A]">
      {header}
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-24 md:px-6 md:pt-28">{children}</main>
      {bottomNavigation}
      {floatingButton}
    </div>
  );
}
