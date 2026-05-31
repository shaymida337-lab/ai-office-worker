"use client";

import { HelpCircle } from "lucide-react";

export function HelpTooltip({ text, label = "מידע" }: { text: string; label?: string }) {
  return (
    <span className="help-tooltip" tabIndex={0} aria-label={`${label}: ${text}`}>
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
      <span className="help-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
