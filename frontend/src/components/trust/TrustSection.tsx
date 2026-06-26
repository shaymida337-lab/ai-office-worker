import type { ReactNode } from "react";

export function TrustSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">{title}</h2>
      <div className="grid gap-3 text-base leading-8 text-slate-600">{children}</div>
    </section>
  );
}

export function TrustList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 ps-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-right">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
