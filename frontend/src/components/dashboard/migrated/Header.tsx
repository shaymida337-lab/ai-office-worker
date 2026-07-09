"use client";

export function Header({
  title,
  subtitle,
  onRefresh,
  refreshLabel,
}: {
  title: string;
  subtitle: string;
  onRefresh: () => void;
  refreshLabel: string;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-[#D9E2F2] bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:h-20 md:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#1D4ED8]">{subtitle}</p>
          <h1 className="truncate text-xl font-black text-[#111827] md:text-2xl">{title}</h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-xl border border-[#C7D2FE] bg-[#EEF2FF] px-4 py-2 text-sm font-bold text-[#1E40AF] transition hover:bg-[#E0E7FF]"
        >
          {refreshLabel}
        </button>
      </div>
    </header>
  );
}
