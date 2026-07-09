"use client";

import type { ReactNode } from "react";
import { natalie } from "./tokens";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`${natalie.card} p-6 text-center`}>
      <p className={`text-base font-black ${natalie.title}`}>{title}</p>
      {description ? <p className={`mt-2 text-sm ${natalie.subtitle}`}>{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
