"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** 4.5rem = Bottom Navigation height; +16px gap; +safe-area for iPhone PWA. */
const FAB_BOTTOM = "calc(4.5rem + env(safe-area-inset-bottom, 0px) + 16px)";
/** Above bottom nav (z-40) and page content; below "More" sheet (z-60). */
const FAB_Z_INDEX = 55;

const fabPinStyle: CSSProperties = {
  position: "fixed",
  bottom: FAB_BOTTOM,
  zIndex: FAB_Z_INDEX,
};

export function FloatingActionButton({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={fabPinStyle}
      className={`end-4 h-14 rounded-full bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-5 text-sm font-black text-white shadow-[0_16px_36px_rgba(37,99,235,0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:end-6 ${className}`}
    >
      {label}
    </button>
  );

  if (!mounted) return null;
  return createPortal(button, document.body);
}
