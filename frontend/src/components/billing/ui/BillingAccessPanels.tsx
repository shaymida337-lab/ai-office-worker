export function BillingAccessPanels({
  availableTitle = "מה עדיין זמין",
  lockedTitle = "מה נעול עד חידוש",
  availableItems,
  lockedItems,
}: {
  availableTitle?: string;
  lockedTitle?: string;
  availableItems: string[];
  lockedItems: string[];
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm">
        <h3 className="text-lg font-extrabold text-emerald-900">{availableTitle}</h3>
        <ul className="mt-4 grid gap-2.5">
          {availableItems.map((item) => (
            <li key={item} className="flex items-start gap-2 text-base text-emerald-800">
              <CheckIcon className="mt-1 shrink-0 text-emerald-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </article>
      <article className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-6 shadow-sm">
        <h3 className="text-lg font-extrabold text-amber-900">{lockedTitle}</h3>
        <ul className="mt-4 grid gap-2.5">
          {lockedItems.map((item) => (
            <li key={item} className="flex items-start gap-2 text-base text-amber-900">
              <LockIcon className="mt-1 shrink-0 text-amber-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`h-5 w-5 ${className ?? ""}`} aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.25a1 1 0 0 1-1.414 0l-3.25-3.25a1 1 0 1 1 1.414-1.414l2.543 2.543 6.543-6.543a1 1 0 0 1 1.412 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={`h-5 w-5 ${className ?? ""}`} aria-hidden>
      <path
        fillRule="evenodd"
        d="M10 2a3 3 0 0 0-3 3v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1V5a3 3 0 0 0-3-3Zm-1 5V5a1 1 0 1 1 2 0v2H9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
