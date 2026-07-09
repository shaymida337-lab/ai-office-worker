"use client";

export function NatalieAssistantCard({
  title,
  recommendation,
  ctaLabel,
  onCta,
}: {
  title: string;
  recommendation: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <section className="rounded-3xl bg-[linear-gradient(135deg,#1D4ED8,#2563EB,#3B82F6)] p-5 text-white shadow-[0_18px_44px_rgba(37,99,235,0.3)] md:p-6">
      <p className="text-sm font-semibold text-blue-100">{title}</p>
      <p className="mt-2 text-lg font-bold leading-7 md:text-xl">{recommendation}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-black text-[#1E40AF] transition hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {ctaLabel}
      </button>
    </section>
  );
}
