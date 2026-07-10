"use client";

import { shellLayout } from "./tokens";

export function FloatingActionButton({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`${shellLayout.fabPosition} h-14 rounded-full bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-5 text-sm font-black text-white shadow-[0_16px_36px_rgba(37,99,235,0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${className}`}
    >
      {label}
    </button>
  );
}
