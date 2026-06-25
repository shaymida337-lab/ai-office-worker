import type { ReactNode } from "react";

export function BillingValueCard({
  label,
  value,
  helper,
  icon,
  accent = "blue",
}: {
  label: string;
  value: string;
  helper?: string;
  icon?: ReactNode;
  accent?: "blue" | "indigo" | "emerald" | "violet";
}) {
  const accentStyles = {
    blue: "from-blue-500/10 to-blue-600/5 border-blue-200/70 text-blue-700",
    indigo: "from-indigo-500/10 to-indigo-600/5 border-indigo-200/70 text-indigo-700",
    emerald: "from-emerald-500/10 to-emerald-600/5 border-emerald-200/70 text-emerald-700",
    violet: "from-violet-500/10 to-violet-600/5 border-violet-200/70 text-violet-700",
  }[accent];

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 md:p-7 ${accentStyles}`}
    >
      <div className="relative z-10 grid gap-3">
        {icon && <div className="text-2xl">{icon}</div>}
        <p className="text-base font-bold text-slate-700 md:text-lg">{label}</p>
        <p className="text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">{value}</p>
        {helper && <p className="text-sm leading-6 text-slate-600 md:text-base">{helper}</p>}
      </div>
      <div className="pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full bg-white/40 blur-2xl" aria-hidden />
    </article>
  );
}
