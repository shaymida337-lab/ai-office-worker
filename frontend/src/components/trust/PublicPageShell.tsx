import type { ReactNode } from "react";
import { PublicSiteFooter } from "./PublicSiteFooter";

export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100svh] min-h-[100dvh] flex-col bg-white text-right">
      <div className="flex-1">{children}</div>
      <PublicSiteFooter variant="light" />
    </div>
  );
}
