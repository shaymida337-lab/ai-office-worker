"use client";

import type { ReactNode } from "react";
import { useState } from "react";

export type NataliePresenceProps = {
  collapsedLabel?: string;
  expandedTitle?: string;
  children?: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
};

/** Replaces the mysterious floating icon with an explicit employee presence. */
export function NataliePresence({
  collapsedLabel = "נטלי כאן",
  expandedTitle = "דבר עם נטלי",
  children,
  defaultExpanded = false,
  className = "",
}: NataliePresenceProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!expanded) {
    return (
      <aside className={className} data-natalie-surface="presence-collapsed" aria-label={collapsedLabel}>
        <button type="button" onClick={() => setExpanded(true)} aria-expanded={false}>
          <span aria-hidden>🤖</span>
          <span>{collapsedLabel}</span>
          <span>אני כאן.</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={className} data-natalie-surface="presence-expanded" aria-label={expandedTitle}>
      <header>
        <h2>{expandedTitle}</h2>
        <button type="button" onClick={() => setExpanded(false)} aria-label="סגור שיחה עם נטלי">
          סגור
        </button>
      </header>
      <div>{children}</div>
    </aside>
  );
}
