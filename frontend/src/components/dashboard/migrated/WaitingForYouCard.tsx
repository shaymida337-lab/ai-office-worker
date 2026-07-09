"use client";

export function WaitingForYouCard({
  title,
  value,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  value: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[#FBCFE8] bg-[#FFF1F7] p-4 shadow-sm">
      <p className="text-sm font-semibold text-[#9D174D]">{title}</p>
      <p className="mt-1 text-2xl font-black text-[#831843]">{value}</p>
      <p className="mt-1 text-sm text-[#9F1239]">{subtitle}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 rounded-xl border border-[#F9A8D4] bg-white px-4 py-2 text-sm font-bold text-[#9D174D] hover:bg-[#FFE4EF]"
      >
        {actionLabel}
      </button>
    </section>
  );
}
