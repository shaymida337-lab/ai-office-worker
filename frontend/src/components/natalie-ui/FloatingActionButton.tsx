"use client";

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
      className={`fixed bottom-20 right-4 z-50 h-14 rounded-full bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-5 text-sm font-black text-white shadow-[0_16px_36px_rgba(37,99,235,0.45)] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:bottom-6 md:right-6 ${className}`}
    >
      {label}
    </button>
  );
}
