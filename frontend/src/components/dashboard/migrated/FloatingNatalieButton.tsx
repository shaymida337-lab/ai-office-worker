"use client";

export function FloatingNatalieButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-20 right-4 z-50 h-14 rounded-full bg-[linear-gradient(135deg,#2563EB,#1D4ED8)] px-5 text-sm font-black text-white shadow-[0_16px_36px_rgba(37,99,235,0.45)] md:bottom-6 md:right-6"
    >
      {label}
    </button>
  );
}
