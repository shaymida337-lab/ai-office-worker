"use client";

import { Headset } from "lucide-react";

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="global-help-button" onClick={onClick} aria-label="פתח עזרה והדרכה">
      <Headset className="h-5 w-5" />
      <span>עזרה והדרכה</span>
    </button>
  );
}
