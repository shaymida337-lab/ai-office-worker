"use client";

import type { ReactNode } from "react";
import { PageTitle } from "./PageTitle";

/** @deprecated Use PageTitle below GlobalHeader in AppShell. */
export function Header({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  onRefresh?: () => void;
  refreshLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="relative">
      <PageTitle title={title} subtitle={subtitle} />
      {actions ? <div className="absolute end-4 top-1/2 -translate-y-1/2">{actions}</div> : null}
    </div>
  );
}
