const TRUST_ITEMS = [
  { icon: "🔒", label: "סליקה מאובטחת" },
  { icon: "📄", label: "חשבונית אוטומטית" },
  { icon: "🔄", label: "ביטול בכל רגע" },
  { icon: "🇮🇱", label: "תמיכה בעברית" },
] as const;

export function BillingTrustStrip() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-4 md:px-6">
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-semibold text-slate-700 md:text-base">
        {TRUST_ITEMS.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
