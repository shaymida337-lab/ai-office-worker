"use client";

import type { ReactNode } from "react";
import { statusBadgeStyles, type StatusBadgeTone } from "./tokens";

export function StatusBadge({ tone, children }: { tone: StatusBadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-8 min-w-11 items-center justify-center whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-bold ${statusBadgeStyles[tone]}`}
    >
      {children}
    </span>
  );
}
